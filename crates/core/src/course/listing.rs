//! Listing one course subfolder, with every entry checked against the course root (SEC-35).
//!
//! A link in `slides/` may lead out of the course: the user put it there, so once they trust the
//! course it belongs to it (D-167, `02-course-folder.md#trust`). It is listed like any slide (a
//! linked folder by the files directly in it), and [`links_out`] names each such link for the
//! trust screen. Nothing here reads a file's content: listing only resolves paths and reads
//! folders. Hidden files and Lecter's own `.lecter/` internals are never course material, wherever
//! a link points ([`hidden`]).

use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};

use super::{CourseFile, MAX_ENTRIES};
use crate::error::{Error, Result};

/// A course subfolder that [`super::open`] lists, under its default name (`02-course-folder.md`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Folder {
    /// `lectures/`: one Markdown file per lecture (`03-lecture-files.md`).
    Lectures,
    /// `slides/`: the professor's files, any type.
    Slides,
    /// `sources/`: textbooks, papers, the syllabus, past exams; any type (D-194).
    Sources,
}

impl Folder {
    /// The folder's name in the course root.
    pub(super) const fn dir(self) -> &'static str {
        match self {
            Self::Lectures => "lectures",
            Self::Slides => "slides",
            Self::Sources => "sources",
        }
    }

    /// Whether a file called `name` belongs in this folder's listing.
    fn wants(self, name: &str) -> bool {
        match self {
            Self::Lectures => Path::new(name).extension().is_some_and(|e| e.eq_ignore_ascii_case("md")),
            Self::Slides | Self::Sources => true,
        }
    }

    /// What an entry that resolves outside the course does to this folder's listing.
    fn escapes(self) -> Escape {
        match self {
            // Lecter writes lecture files: one out of the course fails the open (SEC-35, D-106).
            Self::Lectures => Escape::Refuse,
            // Linked from slides/, it belongs to the course once trusted (D-167).
            Self::Slides => Escape::Follow,
            // Sources are only shown (D-194): such an entry is left out, and the course still opens.
            Self::Sources => Escape::Skip,
        }
    }
}

/// What a folder does with an entry that resolves outside the course.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Escape {
    /// Fail the whole listing with [`Error::OutsideCourse`].
    Refuse,
    /// Leave it out.
    Skip,
    /// List it, and name it in [`links_out`].
    Follow,
}

/// Whether `candidate` lies under `root` (or is `root`) without any `..`, `.` or root component
/// after it. Both should be canonical; a `..` is refused anyway, since `Path::starts_with`
/// compares components and `/c/slides/../../etc` would otherwise count as inside `/c`.
pub fn within(root: &Path, candidate: &Path) -> bool {
    candidate.strip_prefix(root).is_ok_and(|rest| rest.components().all(|c| matches!(c, Component::Normal(_))))
}

/// Whether the canonical `target` is hidden as seen from the canonical folder `from`: some part of
/// it below the folder the two share starts with `.`. That covers a dotfile, anything in a hidden
/// folder such as `.lecter/` (this course's or another's) or `~/.ssh/`, and a link to either.
/// Parts above the shared folder don't count, so a course kept under a hidden folder still lists
/// its own files and the links next to it.
pub(crate) fn hidden(from: &Path, target: &Path) -> bool {
    let shared = from.components().zip(target.components()).take_while(|(a, b)| a == b).count();
    target
        .components()
        .skip(shared)
        .any(|c| matches!(c, Component::Normal(name) if name.as_encoded_bytes().starts_with(b".")))
}

/// A visible entry of `slides/` that resolves outside the course.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LinkOut {
    /// Course-relative, e.g. `slides/week3.pdf`.
    pub path: String,
    /// Where it leads, canonical.
    pub target: PathBuf,
    /// Whether it is course material, so listed: its target isn't [`hidden`].
    pub listed: bool,
}

/// One folder's listing: its files (each with its canonical path) and, for `slides/`, the links
/// that lead out of the course.
#[derive(Debug, Default)]
struct Listing {
    files: Vec<(CourseFile, PathBuf)>,
    out: Vec<LinkOut>,
}

/// The regular files in `root/<folder>`, by name, each with its canonical path. Hidden entries
/// (`.name`) and hidden targets, real subfolders and dangling links are left out, as are names
/// that aren't valid Unicode (the UI and lecture files can't refer to them). A link in `slides/`
/// to a folder lists the visible files directly in that folder as `<link>/<file>`. An entry that
/// resolves outside `root` is listed in `slides/`, fails the whole listing in `lectures/` and is
/// left out of `sources/` ([`Folder::escapes`]).
pub(super) fn files(root: &Path, folder: Folder) -> Result<Vec<(CourseFile, PathBuf)>> {
    Ok(list(root, folder, true)?.files)
}

/// The visible entries of `root/slides/` that resolve outside the canonical course `root`, by
/// path, listed or not. The folders they lead to are not read.
pub(crate) fn links_out(root: &Path) -> Result<Vec<LinkOut>> {
    Ok(list(root, Folder::Slides, false)?.out)
}

/// Lists `root/<folder>`; `expand` reads the folders that `slides/` links lead to.
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
fn list(root: &Path, folder: Folder, expand: bool) -> Result<Listing> {
    let io = |e: std::io::Error| Error::Io(e.kind());
    let real = match std::fs::canonicalize(root.join(folder.dir())) {
        Ok(p) => p,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Listing::default()),
        Err(e) => return Err(io(e)),
    };
    if !within(root, &real) {
        // The subfolder itself leads out: only links *in* slides/ belong to the course (D-167).
        if folder.escapes() == Escape::Skip {
            return Ok(Listing::default());
        }
        return Err(Error::OutsideCourse(folder.dir().to_owned()));
    }
    if !std::fs::metadata(&real).map_err(io)?.is_dir() {
        return Ok(Listing::default());
    }
    let mut out = Listing::default();
    let mut seen = Counter { folder, seen: 0 };
    for entry in std::fs::read_dir(&real).map_err(io)? {
        seen.next()?;
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
        let material = !hidden(root, &target);
        if !within(root, &target) {
            match folder.escapes() {
                Escape::Refuse => return Err(Error::OutsideCourse(path)),
                Escape::Skip => continue,
                Escape::Follow => {
                    out.out.push(LinkOut { path: path.clone(), target: target.clone(), listed: material })
                }
            }
        }
        if !material {
            continue;
        }
        let meta = std::fs::metadata(&target).map_err(io)?;
        if meta.is_file() {
            out.files.push((CourseFile { name, path }, target));
        } else if meta.is_dir() && expand && folder == Folder::Slides && target != real.join(&name) {
            // A link to a folder (a real subfolder canonicalises to its own place).
            linked_folder(&name, &target, &mut seen, &mut out.files)?;
        }
    }
    out.files.sort_by(|a, b| a.0.name.cmp(&b.0.name));
    out.out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// Adds the visible regular files directly in `dir`, the canonical folder that the `slides/` link
/// `link` leads to, as `<link>/<file>`. An entry that leads out of `dir`, or to something hidden
/// in it, is left out: a linked folder brings only its own files.
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
fn linked_folder(link: &str, dir: &Path, seen: &mut Counter, files: &mut Vec<(CourseFile, PathBuf)>) -> Result<()> {
    let io = |e: std::io::Error| Error::Io(e.kind());
    for entry in std::fs::read_dir(dir).map_err(io)? {
        seen.next()?;
        let entry = entry.map_err(io)?;
        let Ok(inner) = entry.file_name().into_string() else { continue };
        if inner.starts_with('.') {
            continue;
        }
        let target = match std::fs::canonicalize(entry.path()) {
            Ok(p) => p,
            Err(e) if e.kind() == ErrorKind::NotFound => continue,
            Err(e) => return Err(io(e)),
        };
        if !within(dir, &target) || hidden(dir, &target) {
            continue;
        }
        if std::fs::metadata(&target).map_err(io)?.is_file() {
            let name = format!("{link}/{inner}");
            let path = format!("{}/{name}", Folder::Slides.dir());
            files.push((CourseFile { name, path }, target));
        }
    }
    Ok(())
}

/// Counts the entries one listing reads, linked folders' included, up to [`MAX_ENTRIES`].
struct Counter {
    folder: Folder,
    seen: usize,
}

impl Counter {
    /// Counts one more entry: [`Error::TooManyEntries`] past the limit.
    fn next(&mut self) -> Result<()> {
        self.seen += 1;
        if self.seen > MAX_ENTRIES {
            return Err(Error::TooManyEntries { folder: self.folder.dir(), limit: MAX_ENTRIES });
        }
        Ok(())
    }
}
