//! The `lecture` area: opening a lecture file of a course the user opened this session and
//! editing it. Opening starts the lecture's save session (`lecter_core::save`), which replays its
//! journal; edits go to that session, which journals and saves them.

use std::path::Path;

use lecter_core::lecture::Lecture;
use lecter_core::save::{Edit, Session};
use tauri::State;

use super::course::ipc_error;
use super::error::{ErrorCode, IpcError};
use super::session::{OpenLectures, OpenedCourses};

/// Opens `path` (`lectures/<name>.md`, relative to the course) in `course`, which must be a
/// course `course_open` returned this session, and returns the whole file with any journal
/// edits newer than it applied. A path outside `lectures/` is E_INVALID_ARGUMENT, a missing
/// file E_NOT_FOUND and a link out of the course E_NOT_TRUSTED. Opening a lecture saves and
/// closes the one open before it.
#[tauri::command]
#[specta::specta]
pub async fn lecture_open(
    courses: State<'_, OpenedCourses>,
    lectures: State<'_, OpenLectures>,
    course: String,
    path: String,
) -> Result<Lecture, IpcError> {
    open(&courses, &lectures, course, path).await
}

/// Applies `edits` to the open lecture `path` of `course`, in order, and returns once they are
/// in its journal. Positions are UTF-16 code units, as CodeMirror counts them, each into the
/// document as of the edit before. A lecture that isn't open is E_INVALID_ARGUMENT, as is a
/// batch that doesn't fit its text (refused whole); a failed journal write is E_IO.
#[tauri::command]
#[specta::specta]
pub async fn lecture_apply_edits(
    courses: State<'_, OpenedCourses>,
    lectures: State<'_, OpenLectures>,
    course: String,
    path: String,
    edits: Vec<Edit>,
) -> Result<(), IpcError> {
    apply_edits(&courses, &lectures, &course, &path, edits).await
}

/// The check every lecture command makes before anything touches the disk: only a folder the
/// user picked in a dialog this session may be read or written (SEC-32, SEC-35). Logged without
/// the path.
fn check_course(courses: &OpenedCourses, command: &str, course: &str) -> Result<(), IpcError> {
    if courses.contains(course) {
        return Ok(());
    }
    tracing::warn!(target: "ipc", command, field = "course", "argument rejected: not an opened course");
    Err(IpcError::new(ErrorCode::InvalidArgument, "Open the course before its lectures."))
}

/// `lecture_open` without Tauri's state wrappers.
async fn open(
    courses: &OpenedCourses,
    lectures: &OpenLectures,
    course: String,
    path: String,
) -> Result<Lecture, IpcError> {
    check_course(courses, "lecture_open", &course)?;
    let lectures = lectures.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (session, others) = lectures.get_or_open(&course, &path, || {
            let (session, opened) = Session::open(Path::new(&course), &path)?;
            tracing::info!(
                target: "ipc",
                command = "lecture_open",
                recovered = opened.recovered,
                kept_aside = opened.kept_aside.is_some(),
                "lecture session started"
            );
            Ok(session)
        })?;
        for other in others {
            // Each saves what is pending; a failure leaves its edits in its journal for next time.
            if other.close().is_err() {
                tracing::warn!(target: "ipc", command = "lecture_open", "the previous lecture could not be saved; its journal keeps the edits");
            }
        }
        session.lecture()
    })
    .await
    .map_err(|_| IpcError::new(ErrorCode::Internal, "Lecter could not open that lecture."))?
    .map_err(ipc_error)
}

/// `lecture_apply_edits` without Tauri's state wrappers.
async fn apply_edits(
    courses: &OpenedCourses,
    lectures: &OpenLectures,
    course: &str,
    path: &str,
    edits: Vec<Edit>,
) -> Result<(), IpcError> {
    check_course(courses, "lecture_apply_edits", course)?;
    let Some(session) = lectures.get(course, path) else {
        tracing::warn!(target: "ipc", command = "lecture_apply_edits", field = "path", "argument rejected: lecture not open");
        return Err(IpcError::new(ErrorCode::InvalidArgument, "Open the lecture before editing it."));
    };
    tauri::async_runtime::spawn_blocking(move || session.apply(edits))
        .await
        .map_err(|_| IpcError::new(ErrorCode::Internal, "Lecter could not save that edit."))?
        .map_err(ipc_error)
}

/// Saves and closes every open lecture: on quit, so the next start has nothing to replay.
pub fn close_all(lectures: &OpenLectures) {
    for session in lectures.take_all() {
        if session.close().is_err() {
            tracing::warn!(target: "ipc", "a lecture could not be saved on quit; its journal keeps the edits");
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

    use lecter_core::testenv::TestEnv;

    use super::*;

    const TEXT: &str = "::: {.slide #s1 n=1}\n:::\n";

    /// A course folder with one lecture, opened (remembered) or not.
    fn course(env: &TestEnv) -> String {
        let dir = env.home().join("STAT311");
        std::fs::create_dir_all(dir.join("lectures")).unwrap_or_else(|e| panic!("{e}"));
        std::fs::write(dir.join("lectures/l07.md"), TEXT).unwrap_or_else(|e| panic!("{e}"));
        std::fs::write(dir.join("lectures/l08.md"), "eight\n").unwrap_or_else(|e| panic!("{e}"));
        let canonical = std::fs::canonicalize(&dir).unwrap_or_else(|e| panic!("{e}"));
        let listing = lecter_core::course::open(&canonical).unwrap_or_else(|e| panic!("{e:?}"));
        listing.path
    }

    fn call(lectures: &OpenLectures, courses: &OpenedCourses, course: &str, path: &str) -> Result<Lecture, IpcError> {
        tauri::async_runtime::block_on(open(courses, lectures, course.to_owned(), path.to_owned()))
    }

    fn edit(
        lectures: &OpenLectures,
        courses: &OpenedCourses,
        course: &str,
        path: &str,
        edits: Vec<Edit>,
    ) -> Result<(), IpcError> {
        tauri::async_runtime::block_on(apply_edits(courses, lectures, course, path, edits))
    }

    fn insert(at: u32, text: &str) -> Vec<Edit> {
        vec![Edit { from: at, to: at, text: text.to_owned() }]
    }

    fn on_disk(course: &str, rel: &str) -> String {
        std::fs::read_to_string(Path::new(course).join(rel)).unwrap_or_else(|e| panic!("{e}"))
    }

    #[test]
    fn opens_a_lecture_of_an_opened_course() {
        let env = TestEnv::new().unwrap_or_else(|e| panic!("{e}"));
        let path = course(&env);
        let courses = OpenedCourses::default();
        courses.remember(&path);
        let lecture =
            call(&OpenLectures::default(), &courses, &path, "lectures/l07.md").unwrap_or_else(|e| panic!("{e:?}"));
        assert_eq!(lecture, Lecture { path: "lectures/l07.md".into(), name: "l07.md".into(), text: TEXT.into() });
    }

    /// SEC-32: a course the user didn't pick this session is refused before the disk is read,
    /// even when the folder and the lecture exist; for edits too.
    #[test]
    fn a_course_not_opened_this_session_is_refused() {
        let env = TestEnv::new().unwrap_or_else(|e| panic!("{e}"));
        let path = course(&env);
        let courses = OpenedCourses::default();
        courses.remember(&format!("{path}-other"));
        let lectures = OpenLectures::default();
        let e = call(&lectures, &courses, &path, "lectures/l07.md").err().unwrap_or_else(|| panic!("opened"));
        assert_eq!((e.code, e.message.as_str()), (ErrorCode::InvalidArgument, "Open the course before its lectures."));
        let e = edit(&lectures, &courses, &path, "lectures/l07.md", insert(0, "x"))
            .err()
            .unwrap_or_else(|| panic!("edited"));
        assert_eq!((e.code, e.message.as_str()), (ErrorCode::InvalidArgument, "Open the course before its lectures."));
        assert!(!Path::new(&path).join(".lecter").exists(), "a refused open touched the course");
    }

    #[test]
    fn core_errors_reach_the_ui_with_their_codes() {
        let env = TestEnv::new().unwrap_or_else(|e| panic!("{e}"));
        let path = course(&env);
        let courses = OpenedCourses::default();
        courses.remember(&path);
        let lectures = OpenLectures::default();
        let e = call(&lectures, &courses, &path, "lectures/l09.md").err().unwrap_or_else(|| panic!("opened"));
        assert_eq!((e.code, e.message.as_str()), (ErrorCode::NotFound, "lectures/l09.md no longer exists."));
        let e = call(&lectures, &courses, &path, "slides/l07.md").err().unwrap_or_else(|| panic!("opened"));
        assert_eq!(e.code, ErrorCode::InvalidArgument);
        call(&lectures, &courses, &path, "lectures/l07.md").unwrap_or_else(|e| panic!("{e:?}"));
        let e = edit(&lectures, &courses, &path, "lectures/l07.md", insert(999, "x"))
            .err()
            .unwrap_or_else(|| panic!("edited"));
        assert_eq!(e.code, ErrorCode::InvalidArgument);
    }

    /// F-021: an edit reaches the open lecture; reopening it shows the edit before it is saved, and
    /// quitting saves it.
    #[test]
    fn edits_go_to_the_open_lecture_and_quit_saves_them() {
        let env = TestEnv::new().unwrap_or_else(|e| panic!("{e}"));
        let path = course(&env);
        let courses = OpenedCourses::default();
        courses.remember(&path);
        let lectures = OpenLectures::default();
        call(&lectures, &courses, &path, "lectures/l07.md").unwrap_or_else(|e| panic!("{e:?}"));
        edit(&lectures, &courses, &path, "lectures/l07.md", insert(0, "% mine\n")).unwrap_or_else(|e| panic!("{e:?}"));
        let again = call(&lectures, &courses, &path, "lectures/l07.md").unwrap_or_else(|e| panic!("{e:?}"));
        assert_eq!(again.text, format!("% mine\n{TEXT}"));
        close_all(&lectures);
        assert_eq!(on_disk(&path, "lectures/l07.md"), format!("% mine\n{TEXT}"));
        assert!(lectures.get(&path, "lectures/l07.md").is_none());
    }

    #[test]
    fn editing_a_lecture_that_is_not_open_is_refused() {
        let env = TestEnv::new().unwrap_or_else(|e| panic!("{e}"));
        let path = course(&env);
        let courses = OpenedCourses::default();
        courses.remember(&path);
        let e = edit(&OpenLectures::default(), &courses, &path, "lectures/l07.md", insert(0, "x"))
            .err()
            .unwrap_or_else(|| panic!("edited"));
        assert_eq!((e.code, e.message.as_str()), (ErrorCode::InvalidArgument, "Open the lecture before editing it."));
        assert_eq!(on_disk(&path, "lectures/l07.md"), TEXT);
    }

    /// The buffer shows one lecture: opening another saves the first and closes its session.
    #[test]
    fn opening_another_lecture_saves_and_closes_the_first() {
        let env = TestEnv::new().unwrap_or_else(|e| panic!("{e}"));
        let path = course(&env);
        let courses = OpenedCourses::default();
        courses.remember(&path);
        let lectures = OpenLectures::default();
        call(&lectures, &courses, &path, "lectures/l07.md").unwrap_or_else(|e| panic!("{e:?}"));
        edit(&lectures, &courses, &path, "lectures/l07.md", insert(0, "x")).unwrap_or_else(|e| panic!("{e:?}"));
        let eight = call(&lectures, &courses, &path, "lectures/l08.md").unwrap_or_else(|e| panic!("{e:?}"));
        assert_eq!(eight.text, "eight\n");
        assert_eq!(on_disk(&path, "lectures/l07.md"), format!("x{TEXT}"));
        assert!(lectures.get(&path, "lectures/l07.md").is_none());
        let e = edit(&lectures, &courses, &path, "lectures/l07.md", insert(0, "y"))
            .err()
            .unwrap_or_else(|| panic!("edited"));
        assert_eq!(e.code, ErrorCode::InvalidArgument);
    }

    /// The contract: `lecture_open(course, path)` and `lecture_apply_edits(course, path, edits)`.
    #[test]
    fn lecture_commands_take_the_course_and_the_path_first() {
        let contract = super::super::contract();
        let args = crate::export::command_args(&contract, "lecture_open");
        assert_eq!(args, Some(vec!["course".to_owned(), "path".to_owned()]));
        let args = crate::export::command_args(&contract, "lecture_apply_edits");
        assert_eq!(args, Some(vec!["course".to_owned(), "path".to_owned(), "edits".to_owned()]));
    }
}
