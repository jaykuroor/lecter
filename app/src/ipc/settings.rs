//! The `settings` area (`12-settings-theme-onboarding.md#settings`): the command line's `:set`
//! reads and writes settings through it (F-040). The core's `SettingsStore` resolves a key over
//! the course and global files and the built-in default, and validates a write against the types
//! the schema is generated from. Each command reads the files afresh, so a value written here, or
//! edited by hand, is the one in force from the next call on: no restart.

use std::path::Path;

use lecter_core::course::trust;
use lecter_core::paths::AppDirs;
use lecter_core::settings::{Scope, SetError, SettingsStore, Source, schema_json};
use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, State};

use super::error::{ErrorCode, IpcError};
use super::lecture::check_course;
use super::session::OpenedCourses;
use super::validate;

/// The longest dotted key a command takes, in bytes (the core reads no longer key).
const MAX_KEY_BYTES: usize = 256;

/// Where the settings files are: the global `config.jsonc` in the config folder.
#[derive(Debug, Clone)]
pub struct SettingsFiles(AppDirs);

impl SettingsFiles {
    /// The settings of the config folder of `dirs`.
    pub fn new(dirs: &AppDirs) -> Self {
        Self(dirs.clone())
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

/// The settings schema (`settings.schema.json`, generated from the core's types) as JSON text:
/// the command line completes keys and values and checks a value from it.
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

/// Writes `key = value` (`value` as JSON text) into the global `config.jsonc`, keeping its
/// comments and other keys, and returns the value then in force (with `course`, as for
/// `settings_get`). A value the setting's type refuses, or an unknown key, is E_INVALID_ARGUMENT
/// with the reason (for a fixed set of values, the list).
#[tauri::command]
#[specta::specta]
pub async fn settings_set(
    app: AppHandle,
    files: State<'_, SettingsFiles>,
    courses: State<'_, OpenedCourses>,
    key: String,
    value: String,
    course: Option<String>,
) -> Result<Setting, IpcError> {
    let setting = set(&files, &courses, key, value, course).await?;
    // A new `ui.theme` applies at once (F-043).
    if setting.key == "ui.theme" {
        let theme = serde_json::from_str::<Option<String>>(&setting.value).ok().flatten();
        super::theme::chosen(&app, theme).await;
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

/// `settings_set` without Tauri's state wrappers.
pub(super) async fn set(
    files: &SettingsFiles,
    courses: &OpenedCourses,
    key: String,
    value: String,
    course: Option<String>,
) -> Result<Setting, IpcError> {
    validate::string("settings_set", "key", &key, MAX_KEY_BYTES)?;
    let value: serde_json::Value = serde_json::from_str(&value)
        .map_err(|_| IpcError::new(ErrorCode::InvalidArgument, format!("The value for {key} is not JSON.")))?;
    let store = open(files, courses, "settings_set", course).await?;
    blocking(move || {
        store.set(Scope::Global, &key, value).map_err(|e| {
            tracing::warn!(target: "ipc", command = "settings_set", key = %key, "setting refused");
            set_error(e)
        })?;
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
    let (dirs, trust) = (files.0.clone(), courses.trust().clone());
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
