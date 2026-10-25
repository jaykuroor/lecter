//! F-020: opening a lecture `.md` from `lectures/` (03-lecture-files.md) with the path checked
//! like any untrusted input (SEC-32, SEC-35).

#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::path::{Path, PathBuf};

use super::*;
use crate::ErrorCode;
use crate::testenv::TestEnv;

const LECTURE: &str = "---\nlecter: 1\nlecture: 7\ntitle: Covariance\n---\n\n\
::: {.slide #s3 n=3 src=\"A3\" title=\"Properties\"}\n## Properties\n\n\
[Covariance is bilinear — $\\operatorname{Cov}(aX,Y)=a\\operatorname{Cov}(X,Y)$]{#s3b1}\n\n:::\n";

fn env() -> TestEnv {
    TestEnv::new().unwrap_or_else(|e| panic!("{e}"))
}

/// A course folder in the test home, with `rel` holding `bytes`.
fn course_with(env: &TestEnv, rel: &str, bytes: &[u8]) -> PathBuf {
    let course = env.home().join("STAT311");
    let p = course.join(rel);
    std::fs::create_dir_all(p.parent().unwrap_or_else(|| panic!("parent"))).unwrap_or_else(|e| panic!("{e}"));
    std::fs::write(&p, bytes).unwrap_or_else(|e| panic!("{e}"));
    course
}

fn refused(course: &Path, rel: &str) -> Error {
    match open(course, rel) {
        Ok(l) => panic!("{rel} opened: {:?}", l.path),
        Err(e) => e,
    }
}

#[test]
fn opens_a_lecture_with_its_text_exactly_as_on_disk() {
    let env = env();
    let course = course_with(&env, "lectures/2026-10-23-l07-covariance.md", LECTURE.as_bytes());
    let lecture = open(&course, "lectures/2026-10-23-l07-covariance.md").unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(
        lecture,
        Lecture {
            path: "lectures/2026-10-23-l07-covariance.md".into(),
            name: "2026-10-23-l07-covariance.md".into(),
            text: LECTURE.into(),
        }
    );
}

#[test]
fn an_upper_case_md_extension_is_a_lecture_too() {
    let env = env();
    let course = course_with(&env, "lectures/L07.MD", b"x\n");
    assert_eq!(open(&course, "lectures/L07.MD").map(|l| l.text), Ok("x\n".to_owned()));
}

#[test]
fn refuses_paths_that_are_not_a_md_file_directly_in_lectures() {
    let env = env();
    let course = course_with(&env, "lectures/l07.md", b"x");
    // Each of these exists or would resolve somewhere real, so only the name check stops it.
    course_with(&env, "slides/l07.md", b"x");
    course_with(&env, "lectures/sub/l07.md", b"x");
    course_with(&env, "lectures/.hidden.md", b"x");
    course_with(&env, "lectures/l07.pdf", b"x");
    course_with(&env, "course.md", b"x");
    for rel in [
        "slides/l07.md",
        "lectures/sub/l07.md",
        "lectures/../course.md",
        "lectures/..",
        "lectures/.hidden.md",
        "lectures/l07.pdf",
        "lectures/l07",
        "lectures/",
        "lectures",
        "lectures\\l07.md",
        "lectures/sub\\..\\l07.md",
        "/lectures/l07.md",
        "./lectures/l07.md",
        "lectures//l07.md",
        "lecturesl07.md",
        "lectures/C:l07.md",
        "lectures/l07.md\0",
        "",
    ] {
        let e = refused(&course, rel);
        assert_eq!(e, Error::NotALecture(rel.to_owned()), "{rel}");
        assert_eq!(e.code(), ErrorCode::InvalidArgument);
    }
}

#[test]
fn a_missing_lecture_is_not_found() {
    let env = env();
    let course = course_with(&env, "lectures/l07.md", b"x");
    assert_eq!(refused(&course, "lectures/l08.md"), Error::LectureNotFound("lectures/l08.md".into()));
}

#[test]
fn a_folder_named_like_a_lecture_is_not_a_lecture() {
    let env = env();
    let course = course_with(&env, "lectures/l07.md/inside.md", b"x");
    assert_eq!(refused(&course, "lectures/l07.md"), Error::NotALecture("lectures/l07.md".into()));
}

#[test]
fn the_course_must_be_an_absolute_existing_folder() {
    let env = env();
    let course = course_with(&env, "lectures/l07.md", b"x");
    assert_eq!(refused(Path::new("STAT311"), "lectures/l07.md"), Error::NotAbsolute);
    assert_eq!(refused(&env.home().join("gone"), "lectures/l07.md"), Error::FolderNotFound);
    assert_eq!(refused(&course.join("lectures/l07.md"), "lectures/l07.md"), Error::NotAFolder);
}

#[cfg(unix)]
#[test]
fn a_lecture_linked_outside_the_course_is_not_trusted() {
    let env = env();
    let course = course_with(&env, "lectures/l07.md", b"x");
    let outside = env.home().join("secret.md");
    std::fs::write(&outside, "secret").unwrap_or_else(|e| panic!("{e}"));
    std::os::unix::fs::symlink(&outside, course.join("lectures/l08.md")).unwrap_or_else(|e| panic!("{e}"));
    let e = refused(&course, "lectures/l08.md");
    assert_eq!(e, Error::OutsideCourse("lectures/l08.md".into()));
    assert_eq!(e.code(), ErrorCode::NotTrusted);
}

#[cfg(unix)]
#[test]
fn a_lecture_linked_inside_the_course_opens() {
    let env = env();
    let course = course_with(&env, "notes/real.md", b"inside\n");
    std::fs::create_dir_all(course.join("lectures")).unwrap_or_else(|e| panic!("{e}"));
    std::os::unix::fs::symlink(course.join("notes/real.md"), course.join("lectures/l07.md"))
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(open(&course, "lectures/l07.md").map(|l| l.text), Ok("inside\n".to_owned()));
}

#[test]
fn reads_up_to_the_limit_and_refuses_one_byte_more() {
    let env = env();
    let course = course_with(&env, "lectures/at.md", b"");
    let at = course.join("lectures/at.md");
    let file = std::fs::OpenOptions::new().write(true).open(&at).unwrap_or_else(|e| panic!("{e}"));
    file.set_len(MAX_LECTURE_BYTES).unwrap_or_else(|e| panic!("{e}"));
    let text = open(&course, "lectures/at.md").map(|l| l.text.len() as u64);
    assert_eq!(text, Ok(MAX_LECTURE_BYTES));
    file.set_len(MAX_LECTURE_BYTES + 1).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(
        refused(&course, "lectures/at.md"),
        Error::LectureTooLarge { path: "lectures/at.md".into(), limit: MAX_LECTURE_BYTES }
    );
}

#[test]
fn a_file_that_is_not_utf8_is_refused() {
    let env = env();
    let course = course_with(&env, "lectures/latin1.md", b"Caf\xe9\n");
    let e = refused(&course, "lectures/latin1.md");
    assert_eq!(e, Error::NotUtf8("lectures/latin1.md".into()));
    assert_eq!(e.code(), ErrorCode::InvalidArgument);
}
