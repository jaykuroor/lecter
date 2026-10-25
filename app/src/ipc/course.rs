//! The `course` area: opening a course folder the user picks in a native dialog.
//! F-018 adds the folder listing and the course-root checks; F-033 the stored trust.

use std::path::{Path, PathBuf};

use serde::Serialize;
use specta::Type;
use tauri::AppHandle;

use super::error::{ErrorCode, IpcError};
use crate::dialog;

/// Whether the folder-trust question (02-course-folder.md#trust) still has to be asked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Trust {
    Ask,
    // Release builds store no trust yet (trusted.jsonc arrives with F-033), so there only the
    // user can answer, on the trust screen; in debug runs the trust test hook can too.
    #[cfg_attr(
        not(any(debug_assertions, feature = "test-hooks")),
        expect(dead_code, reason = "constructed by the debug trust hook until stored trust exists")
    )]
    Trusted,
}

/// `course_open`'s result: the folder the user picked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct CourseOpened {
    /// Canonical absolute path.
    pub path: String,
    /// The folder's own name.
    pub name: String,
    pub trust: Trust,
}

/// Opens the native folder dialog and returns the folder, or `None` if the user cancels. Takes
/// no arguments: the path comes from the dialog, never from the UI (SEC-32, SEC-35).
#[tauri::command]
#[specta::specta]
pub async fn course_open(app: AppHandle) -> Result<Option<CourseOpened>, IpcError> {
    let Some(picked) = dialog::pick_folder(&app).await else {
        return Ok(None);
    };
    let root = tauri::async_runtime::spawn_blocking(move || canonical_folder(&picked))
        .await
        .map_err(|_| IpcError::new(ErrorCode::Internal, "Lecter could not check that folder."))??;
    let (path, name) = names(&root)?;
    Ok(Some(CourseOpened { path, name, trust: trust() }))
}

/// No trust is stored yet (F-033), so every folder asks, unless a debug run answers for the user.
fn trust() -> Trust {
    #[cfg(any(debug_assertions, feature = "test-hooks"))]
    if crate::test_hooks::trust_answered() {
        return Trust::Trusted;
    }
    Trust::Ask
}

/// The picked path, canonicalised (symlinks resolved), if it is an existing folder (SEC-35).
#[allow(clippy::disallowed_methods, reason = "runs inside spawn_blocking, never on the runtime")]
fn canonical_folder(picked: &Path) -> Result<PathBuf, IpcError> {
    if !picked.is_absolute() {
        return Err(IpcError::new(ErrorCode::InvalidArgument, "The chosen folder path is not absolute."));
    }
    let root = std::fs::canonicalize(picked).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => IpcError::new(ErrorCode::NotFound, "That folder no longer exists."),
        _ => IpcError::new(ErrorCode::Io, "Lecter could not read that folder."),
    })?;
    let meta =
        std::fs::metadata(&root).map_err(|_| IpcError::new(ErrorCode::Io, "Lecter could not read that folder."))?;
    if !meta.is_dir() {
        return Err(IpcError::new(ErrorCode::InvalidArgument, "Choose a folder, not a file."));
    }
    Ok(root)
}

/// The path and folder name as UTF-8; the UI and the course files can't hold anything else.
fn names(root: &Path) -> Result<(String, String), IpcError> {
    let not_utf8 = || IpcError::new(ErrorCode::InvalidArgument, "The folder's path is not valid Unicode.");
    let path = root.to_str().ok_or_else(not_utf8)?.to_owned();
    let name = root.file_name().map_or(Some(""), |n| n.to_str()).ok_or_else(not_utf8)?.to_owned();
    Ok((path, name))
}

#[cfg(test)]
#[allow(clippy::disallowed_methods, reason = "tests make fixture folders on plain test threads")]
mod tests {
    use super::*;
    use lecter_core::testenv::TestEnv;

    fn env() -> TestEnv {
        TestEnv::new().unwrap_or_else(|e| panic!("{e}"))
    }

    #[test]
    fn an_existing_folder_is_returned_canonical() {
        let env = env();
        let course = env.home().join("Algebra 101");
        std::fs::create_dir(&course).unwrap_or_else(|e| panic!("{e}"));
        let via_dots = env.home().join("Algebra 101").join("..").join("Algebra 101");
        let root = canonical_folder(&via_dots).unwrap_or_else(|e| panic!("{e:?}"));
        assert_eq!(root, std::fs::canonicalize(&course).unwrap_or_else(|e| panic!("{e}")));
        let (path, name) = names(&root).unwrap_or_else(|e| panic!("{e:?}"));
        assert_eq!(name, "Algebra 101");
        assert!(Path::new(&path).is_absolute());
    }

    #[test]
    fn a_missing_folder_is_not_found() {
        let env = env();
        let err = canonical_folder(&env.home().join("gone")).err().map(|e| e.code);
        assert_eq!(err, Some(ErrorCode::NotFound));
    }

    #[test]
    fn a_file_is_refused() {
        let env = env();
        let file = env.home().join("notes.md");
        std::fs::write(&file, "x").unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(canonical_folder(&file).err().map(|e| e.code), Some(ErrorCode::InvalidArgument));
    }

    #[test]
    fn a_relative_path_is_refused() {
        assert_eq!(canonical_folder(Path::new("courses/x")).err().map(|e| e.code), Some(ErrorCode::InvalidArgument));
    }

    /// SEC-35: a symlink to a folder opens the folder it points at, never the link's own path.
    #[cfg(unix)]
    #[test]
    fn a_symlink_to_a_folder_comes_back_as_the_target() {
        let env = env();
        let target = env.home().join("Real Course");
        std::fs::create_dir(&target).unwrap_or_else(|e| panic!("{e}"));
        let link = env.home().join("Shortcut");
        std::os::unix::fs::symlink(&target, &link).unwrap_or_else(|e| panic!("{e}"));
        let root = canonical_folder(&link).unwrap_or_else(|e| panic!("{e:?}"));
        assert_eq!(root, std::fs::canonicalize(&target).unwrap_or_else(|e| panic!("{e}")));
        assert_eq!(names(&root).unwrap_or_else(|e| panic!("{e:?}")).1, "Real Course");
    }

    /// SEC-35: a symlink is judged by what it points at, so a link to a file is not a folder.
    #[cfg(unix)]
    #[test]
    fn a_symlink_to_a_file_is_refused() {
        let env = env();
        let file = env.home().join("notes.md");
        std::fs::write(&file, "x").unwrap_or_else(|e| panic!("{e}"));
        let link = env.home().join("Looks Like A Course");
        std::os::unix::fs::symlink(&file, &link).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(canonical_folder(&link).err().map(|e| e.code), Some(ErrorCode::InvalidArgument));
    }

    #[test]
    fn result_serialises_with_snake_case_trust() {
        let r = CourseOpened { path: "/c/a".into(), name: "a".into(), trust: Trust::Trusted };
        let json = serde_json::to_value(&r).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(json, serde_json::json!({ "path": "/c/a", "name": "a", "trust": "trusted" }));
    }
}
