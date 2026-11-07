//! A course folder (`02-course-folder.md`): opening one and listing its `lectures/`, `slides/` and
//! `sources/`.
//!
//! [`open`] canonicalises the chosen folder and lists the subfolders. Every listed entry is
//! canonicalised too (symlinks resolved) and checked against the course root (SEC-35): one in
//! `lectures/` that escapes fails the open with [`Error::OutsideCourse`] (`E_NOT_TRUSTED`), one in
//! `sources/` is left out, and a link in `slides/` to a file or folder outside is listed, since it
//! belongs to the course once the user trusts it (D-167; the trust screen names it, and the AI
//! reaches it only through [`trust::course_file`] of a trusted course). Hidden files and `.lecter/`
//! internals are never listed, wherever a link points. Each lecture comes with its front-matter
//! date, read from the file's first 4 KB (`front.rs`, D-194). The app's `course_open` and
//! `lecter-harness course open` both return this listing, so they print the same JSON.
//!
//! Everything here blocks on the file system: async callers run it in `spawn_blocking`.

pub mod details;
mod front;
pub mod known;
mod listing;
pub mod trust;

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{Error, Result};

pub use listing::within;
pub(crate) use listing::{LinkOut, hidden, links_out};

/// The most entries one subfolder listing reads: the contract's list limit (`limits.ipc.list`,
/// 18-contracts.md#validation), so a listing always fits in one IPC answer.
pub const MAX_ENTRIES: usize = 10_000;

/// An opened course folder and the files in its `lectures/`, `slides/` and `sources/`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CourseListing {
    /// Canonical absolute path.
    pub path: String,
    /// The folder's own name.
    pub name: String,
    /// The lecture files (`lectures/*.md`), by name.
    pub lectures: Vec<LectureFile>,
    /// The slide files (`slides/*`), by name.
    pub slides: Vec<CourseFile>,
    /// The source files directly in `sources/` (textbooks, papers, past exams), by name.
    pub sources: Vec<CourseFile>,
}

/// One lecture file in `lectures/`, with its front-matter date when it has one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct LectureFile {
    /// The file name, e.g. `2026-10-23-l07-covariance.md`.
    pub name: String,
    /// The path relative to the course root with `/` separators, e.g. `lectures/l07.md`.
    pub path: String,
    /// The front matter's `date`, shaped `YYYY-MM-DD` (not checked to be a real day), e.g.
    /// `2026-10-23`; `null` when there is none in the file's first 4 KB.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub date: Option<String>,
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
/// it. A missing `lectures/`, `slides/` or `sources/` lists as empty, and so does a `sources/` that
/// can't be read: it is only shown.
pub fn open(picked: &Path) -> Result<CourseListing> {
    let root = canonical_folder(picked)?;
    let path = plain(root.to_str().ok_or(Error::NotUnicode)?);
    let name = root.file_name().map_or(Some(""), |n| n.to_str()).ok_or(Error::NotUnicode)?.to_owned();
    let lectures = listing::files(&root, listing::Folder::Lectures)?
        .into_iter()
        .map(|(CourseFile { name, path }, real)| LectureFile { name, path, date: front::lecture_date(&real) })
        .collect();
    let files = |folder| listing::files(&root, folder).map(|f| f.into_iter().map(|(file, _)| file).collect());
    let slides = files(listing::Folder::Slides)?;
    let sources = files(listing::Folder::Sources).unwrap_or_default();
    Ok(CourseListing { path, name, lectures, slides, sources })
}

/// A canonical path as the user knows it. Windows canonicalisation returns verbatim paths
/// (`\\?\C:\Courses`, `\\?\UNC\server\share`); the same folder without that prefix is
/// `C:\Courses` or `\\server\share`. Anything else is returned as it is.
fn plain(canonical: &str) -> String {
    if let Some(unc) = canonical.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{unc}");
    }
    match canonical.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => rest.to_owned(),
        _ => canonical.to_owned(),
    }
}

/// The chosen path, canonicalised (symlinks resolved), if it is an existing folder (SEC-35).
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
pub(crate) fn canonical_folder(picked: &Path) -> Result<PathBuf> {
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

/// `<course>/<rel>` (`rel` uses `/` separators, e.g. `.lecter/journal`), created if needed, with
/// symlinks resolved. `course` is an absolute course folder, canonicalised here. Each level is checked before anything is
/// created inside it, so a `.lecter` link out of the course is refused with
/// [`Error::OutsideCourse`], not written through (SEC-35).
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
pub fn ensure_dir(course: &Path, rel: &str) -> Result<PathBuf> {
    let io = |e: std::io::Error| Error::Io(e.kind());
    let root = canonical_folder(course)?;
    let mut dir = root.clone();
    for part in rel.split('/') {
        dir.push(part);
        match std::fs::create_dir(&dir) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(io(e)),
        }
        let real = std::fs::canonicalize(&dir).map_err(io)?;
        if !within(&root, &real) {
            return Err(Error::OutsideCourse(rel.to_owned()));
        }
        if !std::fs::metadata(&real).map_err(io)?.is_dir() {
            return Err(Error::Io(std::io::ErrorKind::NotADirectory));
        }
        dir = real;
    }
    Ok(dir)
}

// The fixtures live in a TestEnv home, which exists in debug and test-hooks builds only.
#[cfg(all(test, any(debug_assertions, feature = "test-hooks")))]
mod tests;
#[cfg(all(test, any(debug_assertions, feature = "test-hooks")))]
mod tests_links;
