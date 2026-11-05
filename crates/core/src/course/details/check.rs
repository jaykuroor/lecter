//! What [`super::save`] accepts. The details come from the UI (SEC-32), so each field is checked
//! before anything is written: text is trimmed and bounded, the colour is `#rrggbb`, an image icon
//! is a file inside `.lecter/`, and each mapped folder is a plain course-relative path that stays
//! inside the course (SEC-35).

use std::path::Path;

use super::{CourseDetails, CourseFolders};
use crate::course::within;
use crate::error::{Error, Result};

/// The most characters a name, code, term or professor holds.
pub(crate) const MAX_TEXT_CHARS: usize = 200;
/// The most characters a text icon holds: a letter or two, or one emoji sequence.
pub(crate) const MAX_ICON_CHARS: usize = 8;
/// The most bytes a course-relative path (an icon image or a mapped folder) holds.
pub(crate) const MAX_PATH_BYTES: usize = 255;
/// The image types an icon may be.
const IMAGE_TYPES: [&str; 5] = ["png", "jpg", "jpeg", "webp", "gif"];
/// An image icon's path starts with this.
const ICON_DIR: &str = ".lecter/";

/// `details` as they are written, or why they can't be. `root` is the canonical course folder.
pub(super) fn checked(root: &Path, details: &CourseDetails) -> Result<CourseDetails> {
    let name = text("name", &details.name)?;
    if name.is_empty() {
        return Err(bad("Give the course a name."));
    }
    let f = &details.folders;
    Ok(CourseDetails {
        name,
        code: text("code", &details.code)?,
        term: text("term", &details.term)?,
        professor: text("professor", &details.professor)?,
        icon: icon(root, &details.icon)?,
        color: color(&details.color)?,
        folders: CourseFolders {
            slides: folder(root, "slides", &f.slides)?,
            sources: folder(root, "sources", &f.sources)?,
            lectures: folder(root, "lectures", &f.lectures)?,
            past_papers: folder(root, "past papers", &f.past_papers)?,
        },
    })
}

fn bad(message: impl Into<String>) -> Error {
    Error::BadDetails(message.into())
}

/// Trimmed text of at most [`MAX_TEXT_CHARS`], without control characters.
fn text(field: &str, value: &str) -> Result<String> {
    let v = value.trim();
    if v.chars().count() > MAX_TEXT_CHARS {
        return Err(bad(format!("The {field} is longer than {MAX_TEXT_CHARS} characters.")));
    }
    if v.chars().any(char::is_control) {
        return Err(bad(format!("The {field} can't hold line breaks or control characters.")));
    }
    Ok(v.to_owned())
}

/// `#rrggbb`, in lower case.
fn color(value: &str) -> Result<String> {
    let v = value.trim();
    match v.strip_prefix('#') {
        Some(hex) if hex.len() == 6 && hex.bytes().all(|b| b.is_ascii_hexdigit()) => Ok(v.to_ascii_lowercase()),
        _ => Err(bad("The colour must be written #rrggbb, e.g. #3584e4.")),
    }
}

/// A short text, or the path of an image file inside the course's `.lecter/` folder.
fn icon(root: &Path, value: &str) -> Result<String> {
    let v = value.trim();
    if !v.starts_with(ICON_DIR) {
        let chars = v.chars().count();
        if chars == 0 || chars > MAX_ICON_CHARS || v.chars().any(|c| c.is_control() || c.is_whitespace()) {
            return Err(bad(format!(
                "The icon is a letter (up to {MAX_ICON_CHARS} characters) or an image in .lecter/, e.g. .lecter/icon.png."
            )));
        }
        return Ok(v.to_owned());
    }
    plain_path("icon", v)?;
    let typed = Path::new(v).extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase);
    if !typed.is_some_and(|e| IMAGE_TYPES.contains(&e.as_str())) {
        return Err(bad(format!("The icon must be a {} image.", IMAGE_TYPES.join(", "))));
    }
    match resolved(root, v) {
        Some(Place::Inside { is_dir: false, under }) if under.starts_with(root.join(".lecter")) => Ok(v.to_owned()),
        Some(Place::Inside { .. }) | None => Err(bad(format!("{v} is not an image file in .lecter/."))),
        Some(Place::Outside) => Err(Error::OutsideCourse(v.to_owned())),
    }
}

/// A mapped folder: a plain course-relative path, which (if it exists already) is a folder in the
/// course. A trailing `/` is dropped.
fn folder(root: &Path, field: &str, value: &str) -> Result<String> {
    let v = value.trim().trim_end_matches('/');
    plain_path(field, v)?;
    match resolved(root, v) {
        None | Some(Place::Inside { is_dir: true, .. }) => Ok(v.to_owned()),
        Some(Place::Inside { .. }) => Err(bad(format!("The {field} folder, {v}, is a file."))),
        Some(Place::Outside) => Err(Error::OutsideCourse(v.to_owned())),
    }
}

/// A non-empty relative path with `/` separators and no `.`, `..`, empty or drive parts (SEC-35).
fn plain_path(field: &str, v: &str) -> Result<()> {
    let refuse = || bad(format!("The {field} must be a path inside the course, like sources/past-papers."));
    if v.is_empty() || v.len() > MAX_PATH_BYTES || v.starts_with('/') || v.contains(['\\', ':']) {
        return Err(refuse());
    }
    if v.chars().any(char::is_control) || v.split('/').any(|p| p.is_empty() || p == "." || p == "..") {
        return Err(refuse());
    }
    Ok(())
}

/// Where a course-relative path leads once links are resolved.
enum Place {
    Inside { is_dir: bool, under: std::path::PathBuf },
    Outside,
}

/// Resolves the plain course-relative `rel` under `root`; `None` if nothing is there yet and the
/// deepest part that is there stays in the course.
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
fn resolved(root: &Path, rel: &str) -> Option<Place> {
    let at = rel.split('/').fold(root.to_path_buf(), |p, part| p.join(part));
    let real = match std::fs::canonicalize(&at) {
        Ok(real) => real,
        // A dangling link counts as leading out: it is never followed.
        Err(_) if std::fs::symlink_metadata(&at).is_ok() => return Some(Place::Outside),
        // Not there yet: the folder it would be made in must not be a link out of the course.
        Err(_) => {
            let parent = at.ancestors().skip(1).find(|p| std::fs::symlink_metadata(p).is_ok())?;
            return match std::fs::canonicalize(parent) {
                Ok(p) if within(root, &p) => None,
                _ => Some(Place::Outside),
            };
        }
    };
    if !within(root, &real) {
        return Some(Place::Outside);
    }
    Some(Place::Inside { is_dir: real.is_dir(), under: real })
}
