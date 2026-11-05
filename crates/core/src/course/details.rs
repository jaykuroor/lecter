//! Course details (`02-course-folder.md#course-details-coursejsonc`): the name, code, term,
//! professor, icon, colour and folder mapping in `.lecter/course.jsonc`.
//!
//! After the user trusts a course, a short form fills these. [`pending`] says whether to show it
//! (no details saved yet) and what it starts with: what `course.jsonc` already holds, and guesses
//! from the folder's own name and its subfolders' names ([`guess`]). [`save`] writes them with
//! `"version": 1`, editing the file in place, so its comments, its `settings` object and keys
//! Lecter doesn't know stay as they were. The trust fingerprint covers `settings` only (SEC-25),
//! so saving details never asks the trust question again.
//!
//! Everything here blocks on the file system: async callers run it in `spawn_blocking`.

mod check;
mod guess;

use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::trust::{self, TrustStore};
use super::{canonical_folder, ensure_dir};
use crate::error::{Error, Result};
use crate::settings::{COURSE_FILE, jsonc};

/// The `version` a saved `course.jsonc` carries (18-contracts.md#lecture-and-course-files).
pub const VERSION: u64 = 1;

/// `course.jsonc` as the course-relative path errors name.
pub(crate) const FILE: &str = ".lecter/course.jsonc";

/// What the course details form collects. Every field is always written; empty text is allowed
/// for the code, term and professor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CourseDetails {
    /// The course's name, e.g. `Probability and Statistics`. Never empty.
    pub name: String,
    /// The course code, e.g. `STAT 311`.
    pub code: String,
    /// The term, e.g. `Fall 2026`.
    pub term: String,
    /// The professor, e.g. `Dr. Rivera`.
    pub professor: String,
    /// A short text (a letter, e.g. `S`), or the course-relative path of an image in `.lecter/`,
    /// e.g. `.lecter/icon.png`.
    pub icon: String,
    /// `#rrggbb`, e.g. `#3584e4`.
    pub color: String,
    /// Where the course keeps each kind of file.
    pub folders: CourseFolders,
}

/// The folder mapping: course-relative paths with `/` separators.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CourseFolders {
    /// Slide decks, e.g. `slides`.
    pub slides: String,
    /// Textbooks, papers and past exams, e.g. `sources`.
    pub sources: String,
    /// Lecture notes, e.g. `lectures`.
    pub lectures: String,
    /// Past exam papers, e.g. `sources/past-papers`.
    pub past_papers: String,
}

/// The course details form for the course at `course` (an absolute path), or `None` when its
/// `course.jsonc` already has saved details (a `version`). The form starts from what the file
/// holds, and guesses the rest from the folder's names. A file Lecter can't read starts from the
/// guesses alone; [`save`] then says what is wrong with it.
pub fn pending(course: &Path) -> Result<Option<CourseDetails>> {
    let root = canonical_folder(course)?;
    let stored = stored(&root);
    if stored.as_ref().is_some_and(|m| m.contains_key("version")) {
        return Ok(None);
    }
    let mut details = guess::from_names(&root)?;
    if let Some(map) = stored {
        overlay(&mut details, &map);
    }
    Ok(Some(details))
}

/// Saves `details` for the course at `course` (an absolute path) into `.lecter/course.jsonc`,
/// with `"version": 1`, and returns them as written (trimmed; the colour in lower case). Only a
/// course trusted as it is now may write it: a read-only one is [`Error::CourseReadOnly`]
/// (SEC-27). The file is edited in place, so everything else in it stays; a file Lecter can't
/// edit (broken JSONC, a link out of the course, a newer `version`) is left alone.
pub fn save(store: &TrustStore, course: &Path, details: &CourseDetails) -> Result<CourseDetails> {
    trust::require_trusted(store, course)?;
    let root = canonical_folder(course)?;
    let details = check::checked(&root, details)?;
    let dir = ensure_dir(&root, ".lecter")?;
    let path = dir.join(COURSE_FILE);
    let unusable = |e: jsonc::FileError| match e {
        jsonc::FileError::Io(kind) => Error::ReadFailed { path: FILE.to_owned(), kind },
        jsonc::FileError::OutsideCourse => Error::OutsideCourse(FILE.to_owned()),
        e => Error::CourseFileUnusable { path: FILE.to_owned(), reason: e.to_string() },
    };
    jsonc::check_within(&path, Some(&root)).map_err(unusable)?;
    let text = jsonc::read_text(&path).map_err(unusable)?.unwrap_or_default();
    let existing = jsonc::parse(&text).and_then(|v| jsonc::settings_object(v, None)).map_err(unusable)?;
    if let Some(v) = existing.get("version").filter(|v| v.as_u64() != Some(VERSION)) {
        return Err(Error::CourseFileNewer { path: FILE.to_owned(), version: v.to_string() });
    }
    let mut edited = text;
    for (key, value) in entries(&details) {
        edited = jsonc::set_key(&edited, None, key, &value).map_err(unusable)?;
    }
    write(&path, &edited)?;
    Ok(details)
}

/// The keys `save` writes, in file order (the spec's example), with their values.
fn entries(d: &CourseDetails) -> Vec<(&'static str, Value)> {
    let s = |v: &str| Value::String(v.to_owned());
    vec![
        ("version", Value::from(VERSION)),
        ("name", s(&d.name)),
        ("code", s(&d.code)),
        ("term", s(&d.term)),
        ("professor", s(&d.professor)),
        ("icon", s(&d.icon)),
        ("color", s(&d.color)),
        ("folders.slides", s(&d.folders.slides)),
        ("folders.sources", s(&d.folders.sources)),
        ("folders.lectures", s(&d.folders.lectures)),
        ("folders.pastPapers", s(&d.folders.past_papers)),
    ]
}

/// The top level of the course's `course.jsonc`, if it exists and reads as an object.
fn stored(root: &Path) -> Option<Map<String, Value>> {
    let path = root.join(".lecter").join(COURSE_FILE);
    jsonc::check_within(&path, Some(root)).ok()?;
    let text = jsonc::read_text(&path).ok()??;
    match jsonc::parse(&text).ok()? {
        Value::Object(map) => Some(map),
        _ => None,
    }
}

/// Replaces each guess in `details` with the file's own value, where it has a usable one.
fn overlay(details: &mut CourseDetails, map: &Map<String, Value>) {
    let text = |key: &str| map.get(key).and_then(Value::as_str).map(str::trim).filter(|v| !v.is_empty());
    for (key, field) in [
        ("name", &mut details.name),
        ("code", &mut details.code),
        ("term", &mut details.term),
        ("professor", &mut details.professor),
        ("icon", &mut details.icon),
        ("color", &mut details.color),
    ] {
        if let Some(v) = text(key) {
            v.clone_into(field);
        }
    }
    let Some(Value::Object(folders)) = map.get("folders") else { return };
    let f = &mut details.folders;
    for (key, field) in [
        ("slides", &mut f.slides),
        ("sources", &mut f.sources),
        ("lectures", &mut f.lectures),
        ("pastPapers", &mut f.past_papers),
    ] {
        if let Some(v) = folders.get(key).and_then(Value::as_str).map(str::trim).filter(|v| !v.is_empty()) {
            v.clone_into(field);
        }
    }
}

/// Writes `text` to `path` atomically.
fn write(path: &Path, text: &str) -> Result<()> {
    crate::save::atomic::write(path, text.as_bytes(), || Ok(()))
        .map(drop)
        .map_err(|e| Error::SaveFailed { path: FILE.to_owned(), kind: e.kind() })
}

#[cfg(all(test, any(debug_assertions, feature = "test-hooks")))]
mod tests;
#[cfg(all(test, any(debug_assertions, feature = "test-hooks")))]
mod tests_guess;
