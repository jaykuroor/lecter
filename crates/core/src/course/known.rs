//! The courses on the rail and their order (09-ui.md#layout): the `courses` key of the `meta`
//! table in the app's `<data>/state.db` (D-188), a JSON array of canonical course root paths in
//! rail order. A course joins the list when the user opens its folder; the rail's drag and
//! Shift-J/K rewrite the order.
//!
//! The value is read defensively: anything that isn't an array of absolute paths (a hand edit, a
//! newer Lecter) reads as the entries that are, and a value that isn't an array at all as no
//! courses. Each change is one write transaction, so two app processes never lose each other's
//! courses.
//!
//! Everything here blocks on the disk: async callers run it in `spawn_blocking`.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use serde_json::Value;

use super::details::{self, Face};
use super::{MAX_ENTRIES, canonical_folder, plain};
use crate::error::{Error, Result};
use crate::identity::{STATE_DB, open_state_db};
use crate::paths::AppDirs;

/// The `meta` key that holds the rail's courses.
pub const COURSES_KEY: &str = "courses";

/// One course on the rail, as `course_list` returns it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct KnownCourse {
    /// The course root's canonical path, as `course_open` returned it.
    pub path: String,
    /// The course's name, e.g. `Probability and Statistics`.
    pub name: String,
    /// A short text (e.g. `S`), or the course-relative path of an image in `.lecter/`.
    pub icon: String,
    /// `#rrggbb`, e.g. `#3584e4`.
    pub color: String,
    /// The folder is gone, or its path now leads to another folder: it can't be opened.
    pub missing: bool,
}

/// The rail's courses in `state.db`. Cloning shares nothing but the path.
#[derive(Debug, Clone)]
pub struct KnownCourses {
    db: PathBuf,
}

impl KnownCourses {
    /// The list in `dirs`' data folder.
    pub fn new(dirs: &AppDirs) -> Self {
        Self::at(dirs.data().join(STATE_DB))
    }

    /// The list in the `state.db` at `db`.
    pub fn at(db: PathBuf) -> Self {
        Self { db }
    }

    /// The courses' paths in rail order.
    pub fn paths(&self) -> Result<Vec<String>> {
        self.change(|_| false)
    }

    /// Whether `path` is on the rail, compared exactly.
    pub fn contains(&self, path: &str) -> Result<bool> {
        Ok(self.paths()?.iter().any(|p| p == path))
    }

    /// Puts `path` (a canonical course root) at the end of the rail, unless it is there already.
    /// Returns the paths after it and whether it was added.
    pub fn add(&self, path: &str) -> Result<(Vec<String>, bool)> {
        let mut added = false;
        let paths = self.change(|list| {
            added = usable(path) && !list.iter().any(|p| p == path) && list.len() < MAX_ENTRIES;
            if added {
                list.push(path.to_owned());
            }
            added
        })?;
        Ok((paths, added))
    }

    /// Replaces the rail's order with `order`, which must list each course on it exactly once
    /// ([`Error::BadCourseOrder`] otherwise, and nothing changes). Returns the paths after it.
    pub fn reorder(&self, order: &[String]) -> Result<Vec<String>> {
        let mut bad = false;
        let paths = self.change(|list| {
            let mut have = list.clone();
            let mut want = order.to_vec();
            have.sort();
            want.sort();
            bad = have != want;
            if bad || list.as_slice() == order {
                return false;
            }
            order.clone_into(list);
            true
        })?;
        if bad { Err(Error::BadCourseOrder) } else { Ok(paths) }
    }

    /// The rail's courses in order, each with its name, icon and colour (missing ones marked).
    pub fn list(&self) -> Result<Vec<KnownCourse>> {
        Ok(self.paths()?.iter().map(|p| known(p)).collect())
    }

    /// Reads the list, lets `edit` change it, and writes it back if `edit` says it changed, in one
    /// write transaction. Returns the list as it is after.
    fn change(&self, edit: impl FnOnce(&mut Vec<String>) -> bool) -> Result<Vec<String>> {
        // The app logs the error's code; SQLite's own message stays out of the UI.
        let failed = |_: rusqlite::Error| Error::CourseListFailed;
        let mut conn = self.connect().map_err(failed)?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(failed)?;
        tx.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)", []).map_err(failed)?;
        let stored: Option<String> = tx
            .query_row("SELECT value FROM meta WHERE key = ?1", [COURSES_KEY], |r| r.get(0))
            .optional()
            .map_err(failed)?;
        let mut list = parse(stored.as_deref());
        if edit(&mut list) {
            let value = serde_json::to_string(&list).map_err(|_| Error::CourseListFailed)?;
            tx.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)", [COURSES_KEY, value.as_str()])
                .map_err(failed)?;
        }
        tx.commit().map_err(failed)?;
        Ok(list)
    }

    #[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
    fn connect(&self) -> rusqlite::Result<Connection> {
        if let Some(dir) = self.db.parent() {
            std::fs::create_dir_all(dir).map_err(|e| {
                rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CANTOPEN),
                    Some(e.to_string()),
                )
            })?;
        }
        open_state_db(&self.db)
    }
}

/// The stored value as a list: its absolute-path strings, each once, in order, at most
/// [`MAX_ENTRIES`] (the contract's list limit). Anything else reads as no courses.
fn parse(stored: Option<&str>) -> Vec<String> {
    let Some(Value::Array(items)) = stored.and_then(|s| serde_json::from_str(s).ok()) else {
        return Vec::new();
    };
    let mut list: Vec<String> = Vec::new();
    for path in items.iter().filter_map(Value::as_str).filter(|p| usable(p)) {
        if list.len() == MAX_ENTRIES {
            break;
        }
        if !list.iter().any(|p| p == path) {
            list.push(path.to_owned());
        }
    }
    list
}

/// The longest course path kept, in bytes: far past any real folder, well inside the IPC limits.
const MAX_PATH_BYTES: usize = 4096;

/// Whether `path` can be a course root on the rail: absolute, not too long, no control characters.
fn usable(path: &str) -> bool {
    path.len() <= MAX_PATH_BYTES && !path.chars().any(char::is_control) && Path::new(path).is_absolute()
}

/// `path`'s rail entry. A folder that is gone, or whose canonical path is no longer `path` (a
/// link swapped in, a folder moved and another put there through a link), is missing.
fn known(path: &str) -> KnownCourse {
    let root = canonical_folder(Path::new(path)).ok().filter(|r| r.to_str().map(plain).as_deref() == Some(path));
    let (Face { name, icon, color }, missing) = match root {
        Some(root) => (details::face(&root), false),
        None => (details::face_of_missing(path), true),
    };
    KnownCourse { path: path.to_owned(), name, icon, color, missing }
}

/// The course root of `path`, a course on the rail, checked as the folder dialog's pick is
/// (SEC-32, SEC-35): it must be on the rail ([`Error::CourseNotKnown`]) and still be the folder
/// that was picked ([`Error::CourseMoved`] when it is gone or leads elsewhere).
pub fn stored_root(known: &KnownCourses, path: &str) -> Result<PathBuf> {
    if !known.contains(path)? {
        return Err(Error::CourseNotKnown);
    }
    let root = canonical_folder(Path::new(path)).map_err(|e| match e {
        Error::FolderNotFound | Error::NotAFolder => Error::CourseMoved,
        e => e,
    })?;
    if root.to_str().map(plain).as_deref() != Some(path) {
        return Err(Error::CourseMoved);
    }
    Ok(root)
}

// The fixtures live in a TestEnv home, which exists in debug and test-hooks builds only.
#[cfg(all(test, any(debug_assertions, feature = "test-hooks")))]
mod tests;
