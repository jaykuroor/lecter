//! A course folder (`02-course-folder.md`): opening one and listing its `lectures/` and `slides/`.
//!
//! [`open`] canonicalises the chosen folder and lists both subfolders. Every listed entry is
//! canonicalised too (symlinks resolved) and must stay under the course root (SEC-35); one that
//! escapes fails the open with [`Error::OutsideCourse`] (`E_NOT_TRUSTED`). The app's `course_open`
//! and `lecter-harness course open` both return this listing, so they print the same JSON.
//!
//! Everything here blocks on the file system: async callers run it in `spawn_blocking`.

mod listing;

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{Error, Result};

pub use listing::within;

/// The most entries one subfolder listing reads: the contract's list limit (`limits.ipc.list`,
/// 18-contracts.md#validation), so a listing always fits in one IPC answer.
pub const MAX_ENTRIES: usize = 10_000;

/// An opened course folder and the files in its `lectures/` and `slides/`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CourseListing {
    /// Canonical absolute path.
    pub path: String,
    /// The folder's own name.
    pub name: String,
    /// The lecture files (`lectures/*.md`), by name.
    pub lectures: Vec<CourseFile>,
    /// The slide files (`slides/*`), by name.
    pub slides: Vec<CourseFile>,
}

/// One file in a course subfolder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CourseFile {
    /// The file name, e.g. `07-covariance.pdf`.
    pub name: String,
    /// The path relative to the course root with `/` separators, e.g. `slides/07-covariance.pdf`.
    pub path: String,
}

/// Opens the course folder at `picked` (an absolute path, as a folder dialog returns it) and lists
/// it. A missing `lectures/` or `slides/` lists as empty.
pub fn open(picked: &Path) -> Result<CourseListing> {
    let root = canonical_folder(picked)?;
    let path = root.to_str().ok_or(Error::NotUnicode)?.to_owned();
    let name = root.file_name().map_or(Some(""), |n| n.to_str()).ok_or(Error::NotUnicode)?.to_owned();
    let lectures = listing::files(&root, listing::Folder::Lectures)?;
    let slides = listing::files(&root, listing::Folder::Slides)?;
    Ok(CourseListing { path, name, lectures, slides })
}

/// The chosen path, canonicalised (symlinks resolved), if it is an existing folder (SEC-35).
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
fn canonical_folder(picked: &Path) -> Result<PathBuf> {
    if !picked.is_absolute() {
        return Err(Error::NotAbsolute);
    }
    let root = std::fs::canonicalize(picked).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => Error::FolderNotFound,
        kind => Error::Io(kind),
    })?;
    if !std::fs::metadata(&root).map_err(|e| Error::Io(e.kind()))?.is_dir() {
        return Err(Error::NotAFolder);
    }
    Ok(root)
}

// The fixtures live in a TestEnv home, which exists in debug and test-hooks builds only.
#[cfg(all(test, any(debug_assertions, feature = "test-hooks")))]
mod tests;
