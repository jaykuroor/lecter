//! The settings of one window: the global `config.jsonc` and, with a course open, its
//! `.lecter/course.jsonc` → `settings`. Reloads keep the last good values of a file that is
//! mid-write or broken, and each problem is reported once, not on every reload.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use serde_json::Value;

use super::global_only::{is_global_only, loosens};
use super::jsonc::{self, FileError};
use super::keys::{is_known, validate};
use super::layer::{Layer, Source};
use super::resolve::{Resolved, SettingsStack};
use super::schema::Settings;
use crate::paths::AppDirs;

/// The global settings file in the config folder.
pub const GLOBAL_FILE: &str = "config.jsonc";
/// The course file, inside the course's `.lecter/` folder.
pub const COURSE_FILE: &str = "course.jsonc";
/// The object in `course.jsonc` that holds the course's settings (`02-course-folder.md`).
const COURSE_SECTION: &str = "settings";

/// Which file a write goes to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    /// `config.jsonc`.
    Global,
    /// The open course's `course.jsonc` → `settings`.
    Course,
}

/// Something about a settings file the user should hear about once.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Notice {
    /// Keys no setting has. They stay in the file.
    UnknownKeys {
        /// The file.
        file: PathBuf,
        /// Dotted keys.
        keys: Vec<String>,
    },
    /// Course keys ignored because only the global settings may set them, or because they would
    /// loosen a global value (SEC-25). One notice lists them all.
    GlobalOnlyIgnored {
        /// The course file.
        file: PathBuf,
        /// Dotted keys.
        keys: Vec<String>,
    },
    /// Known keys with values Lecter can't use; their lower level applies.
    InvalidValues {
        /// The file.
        file: PathBuf,
        /// Each key with the reason (allowed values, expected type).
        problems: Vec<(String, String)>,
    },
    /// The file couldn't be used; its last good values stay in force.
    Unreadable {
        /// The file.
        file: PathBuf,
        /// Why, without quoting its text.
        reason: String,
    },
}

/// Why a settings write was refused.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SetError {
    /// No setting has this key.
    #[error("{0} is not a setting")]
    UnknownKey(String),
    /// The value doesn't fit the key.
    #[error("{0}")]
    Invalid(String),
    /// A course can't set this key (SEC-25).
    #[error("{0} can only be set in the global settings")]
    GlobalOnly(String),
    /// A course value would loosen the global one (SEC-25).
    #[error("{0} can't be looser for a course than in the global settings")]
    Loosens(String),
    /// No course is open.
    #[error("no course is open")]
    NoCourse,
    /// The file can't be edited.
    #[error("{file} {error}")]
    File {
        /// The file.
        file: PathBuf,
        /// What went wrong.
        error: FileError,
    },
    /// The write itself failed.
    #[error("could not write {file} ({kind:?})")]
    Write {
        /// The file.
        file: PathBuf,
        /// What the OS reported.
        kind: std::io::ErrorKind,
    },
}

/// One settings file and what was last read from it.
#[derive(Debug)]
struct FileState {
    path: PathBuf,
    section: Option<&'static str>,
    source: Source,
    /// The course root the file must stay under (SEC-35); `None` for the global file.
    root: Option<PathBuf>,
    /// The text last parsed successfully, to skip reloads that change nothing.
    text: Option<String>,
    layer: Layer,
    /// Problems already reported, so each is reported once.
    reported: BTreeSet<String>,
}

impl FileState {
    fn new(path: PathBuf, section: Option<&'static str>, source: Source, root: Option<PathBuf>) -> Self {
        Self { path, section, source, root, text: None, layer: Layer::default(), reported: BTreeSet::new() }
    }

    /// Re-reads the file. Returns whether its values may have changed. A broken file keeps the
    /// last good layer.
    fn reload(&mut self, notices: &mut Vec<Notice>) -> bool {
        let read = jsonc::check_within(&self.path, self.root.as_deref()).and_then(|()| jsonc::read_text(&self.path)).and_then(|text| {
            let text = text.unwrap_or_default();
            if self.text.as_deref() == Some(text.as_str()) {
                return Ok(None);
            }
            let object = jsonc::settings_object(jsonc::parse(&text)?, self.section)?;
            Ok(Some((text, object)))
        });
        match read {
            Ok(None) => false,
            Ok(Some((text, object))) => {
                self.text = Some(text);
                self.layer = Layer::from_value(self.source, &object);
                self.reported.retain(|r| !r.starts_with("unreadable:"));
                true
            }
            Err(error) => {
                if self.report(format!("unreadable:{error}")) {
                    notices.push(Notice::Unreadable { file: self.path.clone(), reason: error.to_string() });
                }
                false
            }
        }
    }

    /// Records `what` as reported; true the first time.
    fn report(&mut self, what: String) -> bool {
        self.reported.insert(what)
    }

    /// The notices for this file's current layer that weren't given before. `loosening` are the
    /// keys the stack dropped (they join the global-only notice).
    fn notices(&mut self, loosening: &[String], notices: &mut Vec<Notice>) {
        let unknown: Vec<String> =
            self.layer.unknown.clone().into_iter().filter(|k| self.report(format!("unknown:{k}"))).collect();
        if !unknown.is_empty() {
            notices.push(Notice::UnknownKeys { file: self.path.clone(), keys: unknown });
        }
        let mut ignored: Vec<String> = self.layer.ignored.iter().chain(loosening).cloned().collect();
        ignored.sort();
        ignored.dedup();
        ignored.retain(|k| self.report(format!("ignored:{k}")));
        if !ignored.is_empty() {
            notices.push(Notice::GlobalOnlyIgnored { file: self.path.clone(), keys: ignored });
        }
        let problems: Vec<(String, String)> =
            self.layer.invalid.clone().into_iter().filter(|(k, r)| self.report(format!("invalid:{k}:{r}"))).collect();
        if !problems.is_empty() {
            notices.push(Notice::InvalidValues { file: self.path.clone(), problems });
        }
    }
}

#[derive(Debug)]
struct State {
    global: FileState,
    course: Option<FileState>,
    stack: SettingsStack,
    pending: Vec<Notice>,
}

impl State {
    /// Rebuilds the chain from the files' layers and queues the new notices.
    fn rebuild(&mut self) {
        self.stack =
            SettingsStack::new(self.global.layer.clone(), self.course.as_ref().map(|c| c.layer.clone()), None, None);
        let loosening: Vec<String> =
            self.stack.loosening().iter().filter(|(s, _)| *s == Source::Course).map(|(_, k)| k.clone()).collect();
        self.global.notices(&[], &mut self.pending);
        if let Some(course) = &mut self.course {
            course.notices(&loosening, &mut self.pending);
        }
    }
}

/// The settings in force for one window, from the global file and the open course's file.
#[derive(Debug)]
pub struct SettingsStore {
    state: Mutex<State>,
}

impl SettingsStore {
    /// Loads the global settings from `dirs` and, if `course_root` is given, the course's.
    /// Never fails: a missing file is empty, a broken one is reported in [`Self::take_notices`].
    /// File reads block: call it on a blocking thread.
    pub fn open(dirs: &AppDirs, course_root: Option<&Path>) -> Self {
        Self::open_files(dirs.config().join(GLOBAL_FILE), course_root.map(|r| r.join(".lecter").join(COURSE_FILE)))
    }

    /// [`Self::open`] with the two file paths given. The course file is `<root>/.lecter/course.jsonc`
    /// and must resolve inside `<root>`.
    pub fn open_files(global: PathBuf, course: Option<PathBuf>) -> Self {
        let mut state = State {
            global: FileState::new(global, None, Source::Global, None),
            course: course.map(|p| {
                let root = p.parent().and_then(Path::parent).map(Path::to_path_buf);
                FileState::new(p, Some(COURSE_SECTION), Source::Course, root)
            }),
            stack: SettingsStack::default(),
            pending: Vec::new(),
        };
        state.global.reload(&mut state.pending);
        if let Some(course) = &mut state.course {
            course.reload(&mut state.pending);
        }
        state.rebuild();
        Self { state: Mutex::new(state) }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The files this store reads (global first), for the watcher.
    pub fn files(&self) -> Vec<PathBuf> {
        let state = self.lock();
        std::iter::once(state.global.path.clone()).chain(state.course.as_ref().map(|c| c.path.clone())).collect()
    }

    /// The effective value of `key` and where it came from; `None` for a key no setting has.
    pub fn get(&self, key: &str) -> Option<Resolved> {
        self.lock().stack.get(key)
    }

    /// Every effective setting, typed.
    pub fn settings(&self) -> Settings {
        self.lock().stack.settings()
    }

    /// Re-reads both files (blocking). Returns whether any value may have changed; new notices
    /// queue for [`Self::take_notices`].
    pub fn reload(&self) -> bool {
        let mut guard = self.lock();
        let state = &mut *guard;
        let mut changed = state.global.reload(&mut state.pending);
        if let Some(course) = &mut state.course {
            changed |= course.reload(&mut state.pending);
        }
        if changed {
            state.rebuild();
        }
        changed
    }

    /// The notices not yet taken. Each problem appears once over the store's life.
    pub fn take_notices(&self) -> Vec<Notice> {
        std::mem::take(&mut self.lock().pending)
    }

    /// Writes `key = value` into the file of `scope`, keeping its comments and every other key,
    /// known or not, and applies it. Blocks: call it on a blocking thread.
    pub fn set(&self, scope: Scope, key: &str, value: Value) -> Result<(), SetError> {
        if scope == Scope::Course && is_global_only(key) {
            return Err(SetError::GlobalOnly(key.to_owned()));
        }
        if !is_known(key) {
            return Err(SetError::UnknownKey(key.to_owned()));
        }
        validate(key, &value).map_err(SetError::Invalid)?;
        let mut guard = self.lock();
        let state = &mut *guard;
        if scope == Scope::Course {
            let global = state.global.layer.get(key).cloned().or_else(|| super::keys::defaults().get(key).cloned());
            if loosens(key, &value, &global.unwrap_or(Value::Null)) {
                return Err(SetError::Loosens(key.to_owned()));
            }
        }
        let file = match scope {
            Scope::Global => &mut state.global,
            Scope::Course => state.course.as_mut().ok_or(SetError::NoCourse)?,
        };
        let file_err = |error| SetError::File { file: file.path.clone(), error };
        jsonc::check_within(&file.path, file.root.as_deref()).map_err(file_err)?;
        let text = jsonc::read_text(&file.path).map_err(file_err)?.unwrap_or_default();
        let edited = jsonc::set_key(&text, file.section, key, &value).map_err(file_err)?;
        write_file(&file.path, &edited).map_err(|kind| SetError::Write { file: file.path.clone(), kind })?;
        let mut notices = Vec::new();
        file.reload(&mut notices);
        state.pending.extend(notices);
        state.rebuild();
        Ok(())
    }
}

/// Writes `text` to `path` atomically, creating its folder.
#[allow(clippy::disallowed_methods, reason = "settings writes run on a blocking thread")]
fn write_file(path: &Path, text: &str) -> Result<(), std::io::ErrorKind> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.kind())?;
    }
    crate::save::atomic::write(path, text.as_bytes(), || Ok(())).map(drop).map_err(|e| e.kind())
}
