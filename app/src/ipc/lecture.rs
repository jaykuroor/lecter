//! The `lecture` area: opening a lecture file of a course the user opened this session
//! (`lecter_core::lecture`). The buffer shows the file's text; F-021 adds edits and saving.

use std::path::Path;

use lecter_core::lecture::{self, Lecture};
use tauri::State;

use super::course::ipc_error;
use super::error::{ErrorCode, IpcError};
use super::session::OpenedCourses;

/// Opens `path` (`lectures/<name>.md`, relative to the course) in `course`, which must be a
/// course `course_open` returned this session, and returns the whole file. A path outside
/// `lectures/` is E_INVALID_ARGUMENT, a missing file E_NOT_FOUND and a link out of the course
/// E_NOT_TRUSTED.
#[tauri::command]
#[specta::specta]
pub async fn lecture_open(
    courses: State<'_, OpenedCourses>,
    course: String,
    path: String,
) -> Result<Lecture, IpcError> {
    open(&courses, course, path).await
}

/// `lecture_open` without Tauri's state wrapper.
async fn open(courses: &OpenedCourses, course: String, path: String) -> Result<Lecture, IpcError> {
    // The course path is checked before anything touches the disk: only a folder the user picked
    // in a dialog this session may be read (SEC-32, SEC-35). Logged without the path.
    if !courses.contains(&course) {
        tracing::warn!(target: "ipc", command = "lecture_open", field = "course", "argument rejected: not an opened course");
        return Err(IpcError::new(ErrorCode::InvalidArgument, "Open the course before its lectures."));
    }
    tauri::async_runtime::spawn_blocking(move || lecture::open(Path::new(&course), &path))
        .await
        .map_err(|_| IpcError::new(ErrorCode::Internal, "Lecter could not open that lecture."))?
        .map_err(ipc_error)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

    use lecter_core::testenv::TestEnv;

    use super::*;

    /// A course folder with one lecture, opened (remembered) or not.
    fn course(env: &TestEnv) -> String {
        let dir = env.home().join("STAT311");
        std::fs::create_dir_all(dir.join("lectures")).unwrap_or_else(|e| panic!("{e}"));
        std::fs::write(dir.join("lectures/l07.md"), "::: {.slide #s1 n=1}\n:::\n").unwrap_or_else(|e| panic!("{e}"));
        let canonical = std::fs::canonicalize(&dir).unwrap_or_else(|e| panic!("{e}"));
        let listing = lecter_core::course::open(&canonical).unwrap_or_else(|e| panic!("{e:?}"));
        listing.path
    }

    fn call(courses: &OpenedCourses, course: &str, path: &str) -> Result<Lecture, IpcError> {
        tauri::async_runtime::block_on(open(courses, course.to_owned(), path.to_owned()))
    }

    #[test]
    fn opens_a_lecture_of_an_opened_course() {
        let env = TestEnv::new().unwrap_or_else(|e| panic!("{e}"));
        let path = course(&env);
        let courses = OpenedCourses::default();
        courses.remember(&path);
        let lecture = call(&courses, &path, "lectures/l07.md").unwrap_or_else(|e| panic!("{e:?}"));
        assert_eq!(
            lecture,
            Lecture {
                path: "lectures/l07.md".into(),
                name: "l07.md".into(),
                text: "::: {.slide #s1 n=1}\n:::\n".into()
            }
        );
    }

    /// SEC-32: a course the user didn't pick this session is refused before the disk is read,
    /// even when the folder and the lecture exist.
    #[test]
    fn a_course_not_opened_this_session_is_refused() {
        let env = TestEnv::new().unwrap_or_else(|e| panic!("{e}"));
        let path = course(&env);
        let courses = OpenedCourses::default();
        courses.remember(&format!("{path}-other"));
        let e = call(&courses, &path, "lectures/l07.md").err().unwrap_or_else(|| panic!("opened"));
        assert_eq!((e.code, e.message.as_str()), (ErrorCode::InvalidArgument, "Open the course before its lectures."));
    }

    #[test]
    fn core_errors_reach_the_ui_with_their_codes() {
        let env = TestEnv::new().unwrap_or_else(|e| panic!("{e}"));
        let path = course(&env);
        let courses = OpenedCourses::default();
        courses.remember(&path);
        let e = call(&courses, &path, "lectures/l08.md").err().unwrap_or_else(|| panic!("opened"));
        assert_eq!((e.code, e.message.as_str()), (ErrorCode::NotFound, "lectures/l08.md no longer exists."));
        let e = call(&courses, &path, "slides/l07.md").err().unwrap_or_else(|| panic!("opened"));
        assert_eq!(e.code, ErrorCode::InvalidArgument);
    }

    /// The contract: `lecture_open(course, path)`, both strings, in that order.
    #[test]
    fn lecture_open_takes_the_course_and_the_path() {
        let args = crate::export::command_args(&super::super::contract(), "lecture_open");
        assert_eq!(args, Some(vec!["course".to_owned(), "path".to_owned()]));
    }
}
