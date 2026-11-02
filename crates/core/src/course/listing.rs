//! Listing one course subfolder, with every entry checked against the course root (SEC-35).

use std::io::ErrorKind;
use std::path::{Component, Path};

use super::{CourseFile, MAX_ENTRIES};
use crate::error::{Error, Result};

/// A course subfolder that [`super::open`] lists, under its default name (`02-course-folder.md`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Folder {
    /// `lectures/`: one Markdown file per lecture (`03-lecture-files.md`).
    Lectures,
    /// `slides/`: the professor's files, any type.
    Slides,
}

impl Folder {
    /// The folder's name in the course root.
    pub(super) const fn dir(self) -> &'static str {
        match self {
            Self::Lectures => "lectures",
            Self::Slides => "slides",
        }
    }

    /// Whether a file called `name` belongs in this folder's listing.
    fn wants(self, name: &str) -> bool {
        match self {
            Self::Lectures => Path::new(name).extension().is_some_and(|e| e.eq_ignore_ascii_case("md")),
            Self::Slides => true,
        }
    }
}

/// Whether `candidate` lies under `root` (or is `root`) without any `..`, `.` or root component
/// after it. Both should be canonical; a `..` is refused anyway, since `Path::starts_with`
/// compares components and `/c/slides/../../etc` would otherwise count as inside `/c`.
pub fn within(root: &Path, candidate: &Path) -> bool {
    candidate.strip_prefix(root).is_ok_and(|rest| rest.components().all(|c| matches!(c, Component::Normal(_))))
}

/// The regular files in `root/<folder>`, by name. Hidden entries (`.name`), folders and dangling
/// links are left out, as are names that aren't valid Unicode (the UI and lecture files can't
/// refer to them). An entry that resolves outside `root` fails the whole listing.
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
pub(super) fn files(root: &Path, folder: Folder) -> Result<Vec<CourseFile>> {
    let io = |e: std::io::Error| Error::Io(e.kind());
    let real = match std::fs::canonicalize(root.join(folder.dir())) {
        Ok(p) => p,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(io(e)),
    };
    if !within(root, &real) {
        return Err(Error::OutsideCourse(folder.dir().to_owned()));
    }
    if !std::fs::metadata(&real).map_err(io)?.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for (seen, entry) in std::fs::read_dir(&real).map_err(io)?.enumerate() {
        if seen >= MAX_ENTRIES {
            return Err(Error::TooManyEntries { folder: folder.dir(), limit: MAX_ENTRIES });
        }
        let entry = entry.map_err(io)?;
        let Ok(name) = entry.file_name().into_string() else { continue };
        if name.starts_with('.') || !folder.wants(&name) {
            continue;
        }
        let path = format!("{}/{name}", folder.dir());
        // Canonicalise every entry, not only those that look like links: junctions and other
        // reparse points don't always report as symlinks.
        let target = match std::fs::canonicalize(entry.path()) {
            Ok(p) => p,
            Err(e) if e.kind() == ErrorKind::NotFound => continue,
            Err(e) => return Err(io(e)),
        };
        if !within(root, &target) {
            return Err(Error::OutsideCourse(path));
        }
        if std::fs::metadata(&target).map_err(io)?.is_file() {
            out.push(CourseFile { name, path });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}
