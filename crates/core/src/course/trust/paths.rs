//! The one way the AI reaches a course file (`13-security.md#folder-access`, SEC-35): the path it
//! names is checked as written, then canonicalised and required to stay under the course root.
//! The one exception is a file a link in `slides/` leads to outside the course, which the course
//! listing lists and the trust screen listed: the AI reaches it only in a course trusted as it is
//! now (D-167).

use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use super::{TrustStore, require_trusted};
use crate::course::listing::{Folder, files};
use crate::course::{canonical_folder, within};
use crate::error::{Error, Result};

/// The longest course-relative path accepted, in bytes.
const MAX_PATH_BYTES: usize = 4096;

/// The real path of the course file `requested` names, relative to the course folder `course`.
///
/// `requested` uses `/` or `\` between parts. It is refused with [`Error::OutsideCourse`]
/// (`E_NOT_TRUSTED`) when it is absolute, a drive or UNC path (`C:\x`, `\\server\share`,
/// `//server/share`), has a `..` part, or, once links are resolved, leads anywhere outside the
/// canonical course root, unless it names, as the listing does, a slide the course lists through
/// a `slides/` link out of the course (a linked file, or a file directly in a linked folder),
/// separators and `.` parts aside. Such a slide is
/// returned only when the course is trusted as it is now ([`require_trusted`] against `store`,
/// whose fingerprint covers every such link and its target), so a link added or re-pointed since
/// the user answered, or a read-only course, is `E_NOT_TRUSTED`. A path that doesn't exist is
/// [`Error::ReadFailed`] with `NotFound`.
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
pub fn course_file(store: &TrustStore, course: &Path, requested: &str) -> Result<PathBuf> {
    let refuse = || Error::OutsideCourse(shown(requested));
    if requested.is_empty() || requested.len() > MAX_PATH_BYTES || requested.contains('\0') {
        return Err(refuse());
    }
    // Both separators split parts on every OS: `..\..\x` means the same on Linux as on Windows.
    let starts_rooted = requested.starts_with(['/', '\\']);
    let mut parts = Vec::new();
    for part in requested.split(['/', '\\']) {
        match part {
            "" | "." => {}
            ".." => return Err(refuse()),
            // `C:`, `C:x` and stream names (`file:stream`) are never plain course paths.
            p if p.contains(':') => return Err(refuse()),
            p => parts.push(p),
        }
    }
    if starts_rooted || parts.is_empty() {
        return Err(refuse());
    }
    let root = canonical_folder(course)?;
    let joined = parts.iter().fold(root.clone(), |p, part| p.join(part));
    let real = std::fs::canonicalize(&joined).map_err(|e| match e.kind() {
        // A link to nowhere looks missing, but it names a place: refuse it as escaping.
        ErrorKind::NotFound if std::fs::symlink_metadata(&joined).is_ok() => refuse(),
        kind => Error::ReadFailed { path: shown(requested), kind },
    })?;
    if within(&root, &real) {
        return Ok(real);
    }
    // Outside: only a slide the listing reaches through a slides/ link (never a hidden one), named
    // as the listing names it, so the same file reached any other way is still refused.
    let named = parts.join("/");
    if !files(&root, Folder::Slides)?.iter().any(|(slide, listed)| slide.path == named && *listed == real) {
        return Err(refuse());
    }
    require_trusted(store, &root)?;
    Ok(real)
}

/// The requested path as an error message may show it: at most 200 characters, one line.
fn shown(requested: &str) -> String {
    let one_line: String = requested.chars().map(|c| if c.is_control() { ' ' } else { c }).take(200).collect();
    one_line
}
