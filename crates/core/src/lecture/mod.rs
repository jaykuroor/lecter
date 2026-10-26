//! Lecture files (`03-lecture-files.md`): opening one from a course's `lectures/` folder.
//!
//! [`open`] reads a lecture `.md` whole, as the UI's buffer shows it: the file is the truth
//! (`01-architecture.md#document-model`), and the slide blocks are already written in its body.
//! The path comes from the UI, so it is checked like any untrusted path (SEC-32, SEC-35): it must
//! name a `.md` file directly in `lectures/`, and once canonicalised it must stay under the course
//! root. The read is bounded by [`MAX_LECTURE_BYTES`].
//!
//! Everything here blocks on the file system: async callers run it in `spawn_blocking`.

use std::io::{ErrorKind, Read};
use std::path::Path;

use serde::Serialize;

use crate::course::{self, within};
use crate::error::{Error, Result};

/// The most bytes one lecture open reads. A 300-slide lecture with glosses is well under 1 MB;
/// this bounds the read and the IPC answer for a file that only claims to be a lecture.
pub const MAX_LECTURE_BYTES: u64 = 16 * 1024 * 1024;

/// The folder lecture files live in (`02-course-folder.md`).
const LECTURES: &str = "lectures";

/// An opened lecture file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Lecture {
    /// The path relative to the course root with `/` separators, e.g. `lectures/l07.md`.
    pub path: String,
    /// The file name, e.g. `l07.md`.
    pub name: String,
    /// The whole file: front matter and body, exactly as on disk.
    pub text: String,
}

/// Opens the lecture at `rel` (course-relative, `lectures/<name>.md`) in the course folder
/// `course` (an absolute path, as `course::open` returned it).
pub fn open(course: &Path, rel: &str) -> Result<Lecture> {
    let name = lecture_name(rel)?;
    let root = course::canonical_folder(course)?;
    let read_failed = |kind| Error::ReadFailed { path: rel.to_owned(), kind };
    #[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
    let real = std::fs::canonicalize(root.join(LECTURES).join(name)).map_err(|e| match e.kind() {
        ErrorKind::NotFound => Error::LectureNotFound(rel.to_owned()),
        kind => read_failed(kind),
    })?;
    if !within(&root, &real) {
        return Err(Error::OutsideCourse(rel.to_owned()));
    }
    // Only a regular file is a lecture, and that is checked before opening: opening a folder
    // fails on Windows (PermissionDenied), and opening a FIFO blocks until a writer appears.
    #[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
    let before = std::fs::metadata(&real).map_err(|e| read_failed(e.kind()))?;
    if !before.is_file() {
        return Err(Error::NotALecture(rel.to_owned()));
    }
    #[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
    let file = std::fs::File::open(&real).map_err(|e| read_failed(e.kind()))?;
    // Checked again on the open handle: the path may have been swapped since.
    let meta = file.metadata().map_err(|e| read_failed(e.kind()))?;
    if !meta.is_file() {
        return Err(Error::NotALecture(rel.to_owned()));
    }
    let too_large = || Error::LectureTooLarge { path: rel.to_owned(), limit: MAX_LECTURE_BYTES };
    if meta.len() > MAX_LECTURE_BYTES {
        return Err(too_large());
    }
    // Read at most one byte past the limit: the file may have grown since `metadata`.
    let mut bytes = Vec::new();
    file.take(MAX_LECTURE_BYTES + 1).read_to_end(&mut bytes).map_err(|e| read_failed(e.kind()))?;
    if bytes.len() as u64 > MAX_LECTURE_BYTES {
        return Err(too_large());
    }
    let text = String::from_utf8(bytes).map_err(|_| Error::NotUtf8(rel.to_owned()))?;
    Ok(Lecture { path: rel.to_owned(), name: name.to_owned(), text })
}

/// The file name in `lectures/<name>.md`, or [`Error::NotALecture`]: one plain, visible name
/// directly in `lectures/` with a `.md` extension. No `..`, no other separators, no subfolders.
fn lecture_name(rel: &str) -> Result<&str> {
    let refuse = || Error::NotALecture(rel.to_owned());
    let name = rel.strip_prefix(LECTURES).and_then(|r| r.strip_prefix('/')).ok_or_else(refuse)?;
    let plain = !name.is_empty()
        && !name.starts_with('.')
        && !name.contains(['/', '\\', ':', '\0'])
        && Path::new(name).extension().is_some_and(|e| e.eq_ignore_ascii_case("md"));
    if plain { Ok(name) } else { Err(refuse()) }
}

// The fixtures live in a TestEnv home, which exists in debug and test-hooks builds only.
#[cfg(all(test, any(debug_assertions, feature = "test-hooks")))]
mod tests;
