//! The one way the AI reaches a course file (`13-security.md#folder-access`, SEC-35): the path it
//! names is checked as written, then canonicalised and required to stay under the course root.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use crate::course::{canonical_folder, within};
use crate::error::{Error, Result};

/// The longest course-relative path accepted, in bytes.
const MAX_PATH_BYTES: usize = 4096;

/// The real path of the course file `requested` names, relative to the course folder `course`.
///
/// `requested` uses `/` or `\` between parts. It is refused with [`Error::OutsideCourse`]
/// (`E_NOT_TRUSTED`) when it is absolute, a drive or UNC path (`C:\x`, `\\server\share`,
/// `//server/share`), has a `..` part, or, once links are resolved, leads anywhere outside the
/// canonical course root. A path that doesn't exist is [`Error::ReadFailed`] with `NotFound`.
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
pub fn course_file(course: &Path, requested: &str) -> Result<PathBuf> {
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
    if within(&root, &real) { Ok(real) } else { Err(refuse()) }
}

/// The requested path as an error message may show it: at most 200 characters, one line.
fn shown(requested: &str) -> String {
    let one_line: String = requested.chars().map(|c| if c.is_control() { ' ' } else { c }).take(200).collect();
    one_line
}
