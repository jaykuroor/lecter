//! The `course` area: opening a course folder the user picks in a native dialog, and returning its
//! `lectures/` and `slides/` listing (`lecter_core::course`). F-033 adds the stored trust.

use lecter_core::course::{self, CourseListing};
use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, State};

use super::error::{ErrorCode, IpcError};
use super::session::OpenedCourses;
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

/// `course_open`'s result: the folder the user picked, its listing (the same JSON the
/// command-line harness prints for `course open`) and whether trust is still to be asked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct CourseOpened {
    #[serde(flatten)]
    pub course: CourseListing,
    pub trust: Trust,
}

/// Opens the native folder dialog and returns the folder with its `lectures/` and `slides/`
/// listing, or `None` if the user cancels. Takes no arguments: the path comes from the dialog,
/// never from the UI (SEC-32, SEC-35). A file linked out of the course fails with E_NOT_TRUSTED.
/// The course is remembered for this session, so its lectures can be opened.
#[tauri::command]
#[specta::specta]
pub async fn course_open(app: AppHandle, courses: State<'_, OpenedCourses>) -> Result<Option<CourseOpened>, IpcError> {
    let Some(picked) = dialog::pick_folder(&app).await else {
        return Ok(None);
    };
    let course = tauri::async_runtime::spawn_blocking(move || course::open(&picked))
        .await
        .map_err(|_| IpcError::new(ErrorCode::Internal, "Lecter could not check that folder."))?
        .map_err(ipc_error)?;
    courses.remember(&course.path);
    Ok(Some(CourseOpened { course, trust: trust() }))
}

/// The core's error as the contract's `IpcError`: its code and its one-sentence message.
pub(super) fn ipc_error(e: lecter_core::Error) -> IpcError {
    IpcError::new(e.code(), e.to_string())
}

/// No trust is stored yet (F-033), so every folder asks, unless a debug run answers for the user.
fn trust() -> Trust {
    #[cfg(any(debug_assertions, feature = "test-hooks"))]
    if crate::test_hooks::trust_answered() {
        return Trust::Trusted;
    }
    Trust::Ask
}

#[cfg(test)]
mod tests {
    use lecter_core::course::CourseFile;

    use super::*;

    /// Criterion 1: `course_open` has no arguments in the contract, so the UI can't hand it a
    /// path; the only folder it opens is the one the dialog (or its debug test hook) returns.
    #[test]
    fn course_open_takes_no_arguments() {
        let args = crate::export::command_args(&super::super::contract(), "course_open");
        assert_eq!(args, Some(Vec::new()));
    }

    /// Criterion 4: the IPC answer is the harness's listing JSON plus `trust`, key for key.
    #[test]
    fn result_is_the_listing_with_trust_beside_it() {
        let course = CourseListing {
            path: "/c/STAT311".into(),
            name: "STAT311".into(),
            lectures: vec![CourseFile { name: "l01.md".into(), path: "lectures/l01.md".into() }],
            slides: vec![CourseFile { name: "01.pdf".into(), path: "slides/01.pdf".into() }],
        };
        let listing = serde_json::to_value(&course).unwrap_or_else(|e| panic!("{e}"));
        let json =
            serde_json::to_value(CourseOpened { course, trust: Trust::Trusted }).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(
            json,
            serde_json::json!({
                "path": "/c/STAT311",
                "name": "STAT311",
                "lectures": [{ "name": "l01.md", "path": "lectures/l01.md" }],
                "slides": [{ "name": "01.pdf", "path": "slides/01.pdf" }],
                "trust": "trusted",
            })
        );
        let mut without_trust = json;
        without_trust.as_object_mut().map(|o| o.remove("trust"));
        assert_eq!(without_trust, listing);
    }

    /// Criterion 2: a link out of the course reaches the UI as E_NOT_TRUSTED with the core's
    /// message, which names the entry.
    #[test]
    fn a_link_out_of_the_course_is_not_trusted_over_ipc() {
        let e = ipc_error(lecter_core::Error::OutsideCourse("slides/07.pdf".into()));
        assert_eq!(e.code, ErrorCode::NotTrusted);
        assert!(!e.retryable);
        assert!(e.message.starts_with("slides/07.pdf points outside the course folder"), "{}", e.message);
        let e = ipc_error(lecter_core::Error::FolderNotFound);
        assert_eq!((e.code, e.message.as_str()), (ErrorCode::NotFound, "That folder no longer exists."));
    }
}
