//! The `settings` area (`12-settings-theme-onboarding.md#settings`): the command line's `:set`
//! (F-040) and the Settings window (F-045) read and write settings through it. The core's
//! `SettingsStore` resolves a key over the course and global files and the built-in default, and
//! validates a write against the types the schema is generated from. Each command reads the files
//! afresh, so a value written here, or edited by hand, is the one in force from the next call on:
//! no restart. Writes take one lock, so two that overlap can't lose either; each is announced
//! with `settings:changed`, which the UI applies at once.

use std::path::Path;
use std::sync::{Arc, Mutex, PoisonError};

use lecter_core::course::trust;
use lecter_core::paths::AppDirs;
use lecter_core::settings::{Scope, SetError, SettingsStore, Source, is_global_only, known_keys, schema_json};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, State};
use tauri_specta::Event;

use super::error::{ErrorCode, IpcError};
use super::lecture::check_course;
use super::session::OpenedCourses;
use super::validate;

/// The longest dotted key a command takes, in bytes (the core reads no longer key).
const MAX_KEY_BYTES: usize = 256;

/// Where the settings files are: the global `config.jsonc` in the config folder; and the lock
/// every write holds from reading its file to writing it back.
#[derive(Debug, Clone)]
pub struct SettingsFiles {
    dirs: AppDirs,
    writing: Arc<Mutex<()>>,
}

impl SettingsFiles {
    /// The settings of the config folder of `dirs`.
    pub fn new(dirs: &AppDirs) -> Self {
        Self { dirs: dirs.clone(), writing: Arc::default() }
    }
}

/// Where a setting's value comes from, most specific first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum SettingSource {
    /// This one prompt.
    Prompt,
    /// The role file of the gloss type.
    Role,
    /// The course's `.lecter/course.jsonc`.
    Course,
    /// The global `config.jsonc`.
    Global,
    /// Lecter's built-in default.
    Default,
}

impl From<Source> for SettingSource {
    fn from(s: Source) -> Self {
        match s {
            Source::Prompt => Self::Prompt,
            Source::Role => Self::Role,
            Source::Course => Self::Course,
            Source::Global => Self::Global,
            Source::Default => Self::Default,
        }
    }
}

/// Which file a write goes to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum SettingScope {
    /// The global `config.jsonc`.
    Global,
    /// The course's `.lecter/course.jsonc` → `settings` (a trusted course only).
    Course,
}

/// One setting as it is in force.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct Setting {
    /// The dotted key, e.g. `ui.performance`.
    pub key: String,
    /// The value as JSON text: `"balanced"`, `false`, `3`, `null`.
    pub value: String,
    /// The level it comes from.
    pub source: SettingSource,
}

/// One setting in force, as the Settings window lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SettingState {
    /// The dotted key, e.g. `ui.performance`.
    pub key: String,
    /// The value as JSON text.
    pub value: String,
    /// The level it comes from.
    pub source: SettingSource,
    /// Only the global settings may set it (SEC-25): a course write is refused.
    pub global_only: bool,
}

/// `settings:changed`: a write changed a setting; `setting` is its value then in force.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type, Event)]
#[tauri_specta(event_name = "settings:changed")]
pub struct SettingsChanged {
    /// The setting written, as `settings_set` answered.
    pub setting: Setting,
}

/// The settings schema (`settings.schema.json`, generated from the core's types) as JSON text:
/// the command line and the Settings window read keys, types and values from it.
#[tauri::command]
#[specta::specta]
pub async fn settings_schema() -> Result<String, IpcError> {
    Ok(schema_json())
}

/// The value of `key` in force, and its level. With `course` (a course `course_open` returned this
/// session), the course's own settings count when it is trusted. An unknown key is E_NOT_FOUND.
#[tauri::command]
#[specta::specta]
pub async fn settings_get(
    files: State<'_, SettingsFiles>,
    courses: State<'_, OpenedCourses>,
    key: String,
    course: Option<String>,
) -> Result<Setting, IpcError> {
    get(&files, &courses, key, course).await
}

/// Every setting in force, in key order, with its level and whether only the global settings may
/// set it (with `course`, as for `settings_get`): the Settings window's values, in one read.
#[tauri::command]
#[specta::specta]
pub async fn settings_source(
    files: State<'_, SettingsFiles>,
    courses: State<'_, OpenedCourses>,
    course: Option<String>,
) -> Result<Vec<SettingState>, IpcError> {
    source(&files, &courses, course).await
}

/// Writes `key = value` (`value` as JSON text) into the file of `scope`, keeping its comments and
/// other keys, and returns the value then in force (with `course`, as for `settings_get`);
/// `settings:changed` follows. `global` is `config.jsonc`; `course` is the trusted `course`'s
/// `.lecter/course.jsonc` (an untrusted or read-only one is E_NOT_TRUSTED), which never takes a
/// global-only key (SEC-25). A value the setting's type refuses, or an unknown key, is
/// E_INVALID_ARGUMENT with the reason (for a fixed set of values, the list).
#[tauri::command]
#[specta::specta]
pub async fn settings_set(
    app: AppHandle,
    files: State<'_, SettingsFiles>,
    courses: State<'_, OpenedCourses>,
    key: String,
    value: String,
    course: Option<String>,
    scope: SettingScope,
) -> Result<Setting, IpcError> {
    let setting = set(&files, &courses, key, value, course, scope).await?;
    // A new `ui.theme` applies at once (F-043).
    if setting.key == "ui.theme" {
        let theme = serde_json::from_str::<Option<String>>(&setting.value).ok().flatten();
        super::theme::chosen(&app, theme).await;
    }
    if let Err(e) = (SettingsChanged { setting: setting.clone() }).emit(&app) {
        tracing::warn!(target: "ipc", event = "settings:changed", error = %e, "event not sent");
    }
    Ok(setting)
}

/// `settings_get` without Tauri's state wrappers.
pub(super) async fn get(
    files: &SettingsFiles,
    courses: &OpenedCourses,
    key: String,
    course: Option<String>,
) -> Result<Setting, IpcError> {
    validate::string("settings_get", "key", &key, MAX_KEY_BYTES)?;
    let store = open(files, courses, "settings_get", course).await?;
    blocking(move || resolved(&store, &key)).await
}

/// `settings_source` without Tauri's state wrappers.
pub(super) async fn source(
    files: &SettingsFiles,
    courses: &OpenedCourses,
    course: Option<String>,
) -> Result<Vec<SettingState>, IpcError> {
    let store = open(files, courses, "settings_source", course).await?;
    blocking(move || {
        known_keys()
            .map(|key| {
                let s = resolved(&store, key)?;
                Ok(SettingState { key: s.key, value: s.value, source: s.source, global_only: is_global_only(key) })
            })
            .collect()
    })
    .await
}

/// `settings_set` without Tauri's state wrappers.
pub(super) async fn set(
    files: &SettingsFiles,
    courses: &OpenedCourses,
    key: String,
    value: String,
    course: Option<String>,
    scope: SettingScope,
) -> Result<Setting, IpcError> {
    validate::string("settings_set", "key", &key, MAX_KEY_BYTES)?;
    let value: serde_json::Value = serde_json::from_str(&value)
        .map_err(|_| IpcError::new(ErrorCode::InvalidArgument, format!("The value for {key} is not JSON.")))?;
    // The course whose file a course write goes to.
    let target = match (scope, &course) {
        (SettingScope::Global, _) => None,
        (SettingScope::Course, None) => {
            return Err(IpcError::new(ErrorCode::InvalidArgument, "Open a course to change its settings."));
        }
        (SettingScope::Course, Some(c)) => Some(c.clone()),
    };
    let store = open(files, courses, "settings_set", course).await?;
    let (writing, trust) = (files.writing.clone(), courses.trust().clone());
    blocking(move || {
        // From reading the file to writing it back, one write at a time.
        let _one = writing.lock().unwrap_or_else(PoisonError::into_inner);
        let not_trusted = || IpcError::new(ErrorCode::NotTrusted, "Trust this course to give it settings of its own.");
        if let Some(root) = &target {
            trust::require_trusted(&trust, Path::new(root)).map_err(|_| not_trusted())?;
        }
        let scope = if target.is_some() { Scope::Course } else { Scope::Global };
        store.set(scope, &key, value).map_err(|e| {
            tracing::warn!(target: "ipc", command = "settings_set", key = %key, "setting refused");
            set_error(e)
        })?;
        // The trust screen lists the course's settings, and a change asks again (SEC-25); this one
        // is the user's own, made here, so the course stays trusted with them.
        if let Some(root) = &target {
            trust::renew_after_own_settings_write(&trust, Path::new(root)).map_err(|_| not_trusted())?;
        }
        resolved(&store, &key)
    })
    .await
}

/// The store of the global file and, for a trusted `course` opened this session, its file.
async fn open(
    files: &SettingsFiles,
    courses: &OpenedCourses,
    command: &str,
    course: Option<String>,
) -> Result<SettingsStore, IpcError> {
    if let Some(course) = &course {
        check_course(courses, command, course)?;
    }
    let (dirs, trust) = (files.dirs.clone(), courses.trust().clone());
    blocking(move || {
        // An untrusted or read-only course's settings don't apply (its course.jsonc is one of the
        // files its trust screen showed).
        let root = course.filter(|c| trust::require_trusted(&trust, Path::new(c)).is_ok());
        Ok(SettingsStore::open(&dirs, root.as_deref().map(Path::new)))
    })
    .await
}

/// `key` as `store` resolves it.
fn resolved(store: &SettingsStore, key: &str) -> Result<Setting, IpcError> {
    let r = store.get(key).ok_or_else(|| IpcError::new(ErrorCode::NotFound, format!("{key} is not a setting")))?;
    Ok(Setting { key: key.to_owned(), value: r.value.to_string(), source: r.source.into() })
}

/// A refused write as the contract's error: the reason, in the core's words.
fn set_error(e: SetError) -> IpcError {
    let code = match e {
        SetError::File { .. } | SetError::Write { .. } => ErrorCode::Io,
        _ => ErrorCode::InvalidArgument,
    };
    IpcError::new(code, e.to_string())
}

/// Runs the blocking file work on a blocking thread.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, IpcError> + Send + 'static,
) -> Result<T, IpcError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| IpcError::new(ErrorCode::Internal, "Lecter could not read the settings."))?
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_scope;
