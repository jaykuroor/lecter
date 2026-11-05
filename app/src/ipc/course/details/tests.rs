#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::path::PathBuf;

use lecter_core::course::details::CourseFolders;
use lecter_core::course::trust::{TrustChoice, TrustState, TrustStore};
use lecter_core::testenv::TestEnv;

use super::super::{CourseTrusted, answer, open};
use super::*;
use crate::ipc::error::ErrorCode;

/// A new course: lectures and slides, no `.lecter/` yet.
fn course(env: &TestEnv) -> PathBuf {
    let dir = env.home().join("STAT311 - Probability and Statistics");
    std::fs::create_dir_all(dir.join("lectures")).unwrap();
    std::fs::create_dir_all(dir.join("slides")).unwrap();
    std::fs::write(dir.join("lectures/l01.md"), "::: {.slide #s1 n=1}\n:::\n").unwrap();
    std::fs::canonicalize(dir).unwrap()
}

/// Opens `dir` (no trust hook) and answers its trust screen with `choice`.
fn trusted(courses: &OpenedCourses, dir: &Path, choice: TrustChoice) -> (String, CourseTrusted) {
    let path =
        tauri::async_runtime::block_on(open(courses, dir.to_path_buf(), "sample".into(), false)).unwrap().course.path;
    let got = tauri::async_runtime::block_on(answer(courses, path.clone(), choice, "sample".into())).unwrap();
    (path, got)
}

fn save_details(courses: &OpenedCourses, path: &str, details: CourseDetails) -> Result<CourseDetails, IpcError> {
    tauri::async_runtime::block_on(save(courses, path.to_owned(), details))
}

fn expected() -> CourseDetails {
    CourseDetails {
        name: "Probability and Statistics".into(),
        code: "STAT 311".into(),
        term: String::new(),
        professor: String::new(),
        icon: "S".into(),
        color: "#3584e4".into(),
        folders: CourseFolders {
            slides: "slides".into(),
            sources: "sources".into(),
            lectures: "lectures".into(),
            past_papers: "sources/past-papers".into(),
        },
    }
}

/// The contract: `course_details_save(course, details)` (18-contracts.md#ipc, area `course`).
#[test]
fn course_details_save_takes_the_course_and_the_details() {
    let args = crate::export::command_args(&super::super::super::contract(), "course_details_save");
    assert_eq!(args, Some(vec!["course".to_owned(), "details".to_owned()]));
}

/// Criterion 1: answering Trust brings the details form, pre-filled from the folder names; Save
/// writes `course.jsonc` with version 1; the course stays trusted and the form isn't offered again.
#[test]
fn trust_brings_the_form_and_save_writes_course_jsonc() {
    let env = TestEnv::new().unwrap();
    let dir = course(&env);
    let courses = OpenedCourses::new(TrustStore::new(&env.dirs()));
    let (path, got) = trusted(&courses, &dir, TrustChoice::Trusted);
    assert_eq!((got.trust, got.details.clone()), (TrustState::Trusted, Some(expected())));
    let mine = CourseDetails { professor: "Dr. Rivera".into(), term: "Fall 2026".into(), ..expected() };
    assert_eq!(save_details(&courses, &path, mine.clone()).unwrap(), mine);
    let text = std::fs::read_to_string(dir.join(".lecter/course.jsonc")).unwrap();
    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!((v["version"].clone(), v["professor"].clone()), (serde_json::json!(1), serde_json::json!("Dr. Rivera")));
    // Saving didn't change what trust covers: the next open doesn't ask, and AI stays on.
    let again = OpenedCourses::new(TrustStore::new(&env.dirs()));
    let reopened = tauri::async_runtime::block_on(open(&again, dir.clone(), "sample".into(), false)).unwrap();
    assert_eq!(reopened.trust, TrustState::Trusted);
    assert_eq!(super::super::require_trusted(again.trust(), &path), Ok(()));
    // A later Trust answer (the folder moved back, say) doesn't offer the form again.
    let (_, later) = trusted(&again, &dir, TrustChoice::Trusted);
    assert_eq!(later.details, None);
}

/// Read-only courses get no form, and a save for one is E_NOT_TRUSTED with nothing written.
#[test]
fn a_read_only_course_gets_no_form_and_no_file() {
    let env = TestEnv::new().unwrap();
    let dir = course(&env);
    let courses = OpenedCourses::new(TrustStore::new(&env.dirs()));
    let (path, got) = trusted(&courses, &dir, TrustChoice::ReadOnly);
    assert_eq!((got.trust, got.details), (TrustState::ReadOnly, None));
    let e = save_details(&courses, &path, expected()).unwrap_err();
    assert_eq!(e.code, ErrorCode::NotTrusted);
    assert!(!dir.join(".lecter").exists());
}

/// SEC-32: only a course opened this session can be saved for; bad fields come back with the
/// core's reason.
#[test]
fn saves_for_unopened_courses_or_bad_fields_are_refused() {
    let env = TestEnv::new().unwrap();
    let dir = course(&env);
    let courses = OpenedCourses::new(TrustStore::new(&env.dirs()));
    let e = save_details(&courses, dir.to_str().unwrap(), expected()).unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidArgument);
    let (path, _) = trusted(&courses, &dir, TrustChoice::Trusted);
    let e = save_details(&courses, &path, CourseDetails { color: "red".into(), ..expected() }).unwrap_err();
    assert_eq!(
        (e.code, e.message.as_str()),
        (ErrorCode::InvalidArgument, "The colour must be written #rrggbb, e.g. #3584e4.")
    );
    assert!(!dir.join(".lecter/course.jsonc").exists());
}
