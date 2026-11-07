//! F-018: opening a course folder and listing `lectures/` and `slides/` (02-course-folder.md),
//! with canonical paths and symlinks out of the course rejected with E_NOT_TRUSTED (SEC-35), except
//! links in `slides/` (D-167; `tests_links.rs`, F-047).

#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::path::{Path, PathBuf};

use super::*;
use crate::ErrorCode;
use crate::testenv::TestEnv;

pub(super) fn env() -> TestEnv {
    TestEnv::new().unwrap_or_else(|e| panic!("{e}"))
}

/// Creates `rel` under `dir` (and its parents) as a small file.
pub(super) fn touch(dir: &Path, rel: &str) -> PathBuf {
    let p = dir.join(rel);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).unwrap_or_else(|e| panic!("{e}"));
    }
    std::fs::write(&p, "x").unwrap_or_else(|e| panic!("{e}"));
    p
}

pub(super) fn mkdir(dir: &Path, rel: &str) -> PathBuf {
    let p = dir.join(rel);
    std::fs::create_dir_all(&p).unwrap_or_else(|e| panic!("{e}"));
    p
}

/// The path the listing shows for folder `p`: canonical, without a Windows verbatim prefix.
fn shown(p: &Path) -> String {
    let canonical = std::fs::canonicalize(p).unwrap_or_else(|e| panic!("{e}"));
    plain(canonical.to_str().unwrap_or_else(|| panic!("utf-8")))
}

pub(super) fn file(dir: &str, name: &str) -> CourseFile {
    CourseFile { name: name.to_owned(), path: format!("{dir}/{name}") }
}

/// A lecture without a front-matter date (the fixtures' files hold `x`).
fn lecture(name: &str) -> LectureFile {
    LectureFile { name: name.to_owned(), path: format!("lectures/{name}"), date: None }
}

#[cfg(unix)]
pub(super) fn link(target: &Path, at: &Path) {
    std::os::unix::fs::symlink(target, at).unwrap_or_else(|e| panic!("{e}"));
}

#[cfg(windows)]
pub(super) fn link(target: &Path, at: &Path) {
    let made = if target.is_dir() {
        std::os::windows::fs::symlink_dir(target, at)
    } else {
        std::os::windows::fs::symlink_file(target, at)
    };
    made.unwrap_or_else(|e| panic!("symlinks need developer mode on Windows: {e}"));
}

pub(super) fn open_ok(course: &Path) -> CourseListing {
    open(course).unwrap_or_else(|e| panic!("{e:?}"))
}

pub(super) fn open_err(course: &Path) -> Error {
    open(course).err().unwrap_or_else(|| panic!("{} opened", course.display()))
}

#[test]
fn lists_lecture_markdown_and_every_slide_file_by_name() {
    let env = env();
    let course = mkdir(env.home(), "STAT311");
    touch(&course, "lectures/2026-09-09-l02-probability.md");
    touch(&course, "lectures/2026-09-02-l01-introduction.md");
    touch(&course, "lectures/scratch.txt");
    touch(&course, "lectures/assets/l01/fig-1.svg");
    touch(&course, "slides/07-covariance.pdf");
    touch(&course, "slides/07b-examples.pptx");
    touch(&course, "slides/01-intro.pdf");
    touch(&course, "slides/.DS_Store");
    touch(&course, "sources/book.pdf");
    mkdir(&course, "slides/old");

    let listing = open_ok(&course);
    assert_eq!(
        listing,
        CourseListing {
            path: shown(&course),
            name: "STAT311".into(),
            lectures: vec![lecture("2026-09-02-l01-introduction.md"), lecture("2026-09-09-l02-probability.md"),],
            slides: vec![
                file("slides", "01-intro.pdf"),
                file("slides", "07-covariance.pdf"),
                file("slides", "07b-examples.pptx"),
            ],
            sources: vec![file("sources", "book.pdf")],
        }
    );
}

// D-194: sources/ lists like slides/ (top-level files by name), and each lecture carries its
// front-matter date.
#[test]
fn lists_sources_by_name_and_each_lectures_date() {
    let env = env();
    let course = mkdir(env.home(), "c");
    std::fs::create_dir_all(course.join("lectures")).unwrap_or_else(|e| panic!("{e}"));
    std::fs::write(course.join("lectures/l07.md"), "---\nlecter: 1\nlecture: 7\ndate: 2026-10-23\n---\n")
        .unwrap_or_else(|e| panic!("{e}"));
    touch(&course, "lectures/l08.md");
    touch(&course, "sources/textbook.pdf");
    touch(&course, "sources/a-syllabus.docx");
    touch(&course, "sources/.hidden.pdf");
    touch(&course, "sources/past-papers/2025.pdf");
    let listing = open_ok(&course);
    assert_eq!(
        listing.lectures,
        vec![
            LectureFile { name: "l07.md".into(), path: "lectures/l07.md".into(), date: Some("2026-10-23".into()) },
            lecture("l08.md"),
        ]
    );
    assert_eq!(listing.sources, vec![file("sources", "a-syllabus.docx"), file("sources", "textbook.pdf")]);
}

// Sources are only shown: one that leads out of the course is left out, and the course still opens.
#[cfg(unix)]
#[test]
fn a_source_linked_out_of_the_course_is_left_out() {
    let env = env();
    let course = mkdir(env.home(), "c");
    let outside = touch(env.home(), "private/secret.pdf");
    touch(&course, "sources/book.pdf");
    link(&outside, &course.join("sources/leak.pdf"));
    assert_eq!(open_ok(&course).sources, vec![file("sources", "book.pdf")]);
    // The whole folder linked out lists as empty.
    let other = mkdir(env.home(), "d");
    link(&env.home().join("private"), &other.join("sources"));
    assert_eq!(open_ok(&other).sources, vec![]);
}

#[test]
fn a_lecture_extension_in_capitals_is_still_markdown() {
    let env = env();
    let course = mkdir(env.home(), "c");
    touch(&course, "lectures/L01.MD");
    touch(&course, "lectures/md");
    touch(&course, "lectures/notes.mdx");
    assert_eq!(open_ok(&course).lectures, vec![lecture("L01.MD")]);
}

#[test]
fn a_folder_without_lectures_or_slides_lists_both_empty() {
    let env = env();
    let course = mkdir(env.home(), "Empty Course");
    let listing = open_ok(&course);
    assert_eq!(listing.name, "Empty Course");
    assert!(listing.lectures.is_empty() && listing.slides.is_empty(), "{listing:?}");
}

#[test]
fn a_slides_file_instead_of_a_folder_lists_no_slides() {
    let env = env();
    let course = mkdir(env.home(), "c");
    touch(&course, "slides");
    touch(&course, "lectures/l01.md");
    let listing = open_ok(&course);
    assert!(listing.slides.is_empty());
    assert_eq!(listing.lectures, vec![lecture("l01.md")]);
}

#[test]
fn the_path_is_canonical_even_when_picked_through_dots() {
    let env = env();
    let course = mkdir(env.home(), "Algebra 101");
    let via_dots = env.home().join("Algebra 101").join("..").join("Algebra 101");
    let listing = open_ok(&via_dots);
    assert_eq!(listing.path, shown(&course));
    assert_eq!(listing.name, "Algebra 101");
}

#[test]
fn a_relative_missing_or_file_path_is_refused_with_its_code() {
    let env = env();
    let file = touch(env.home(), "notes.md");
    let cases = [
        (PathBuf::from("courses/x"), Error::NotAbsolute, ErrorCode::InvalidArgument),
        (env.home().join("gone"), Error::FolderNotFound, ErrorCode::NotFound),
        (file, Error::NotAFolder, ErrorCode::InvalidArgument),
    ];
    for (path, want, code) in cases {
        let got = open_err(&path);
        assert_eq!(got, want, "{}", path.display());
        assert_eq!(got.code(), code);
    }
}

#[test]
fn a_subfolder_at_the_entry_limit_lists_and_one_more_is_refused() {
    let env = env();
    let course = mkdir(env.home(), "c");
    let slides = mkdir(&course, "slides");
    // Hidden entries count too: the limit bounds the work, not just the answer.
    for i in 0..MAX_ENTRIES - 1 {
        std::fs::write(slides.join(format!("s{i:05}.pdf")), "").unwrap_or_else(|e| panic!("{e}"));
    }
    std::fs::write(slides.join(".hidden"), "").unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(open_ok(&course).slides.len(), MAX_ENTRIES - 1);
    std::fs::write(slides.join("one-more.pdf"), "").unwrap_or_else(|e| panic!("{e}"));
    let err = open_err(&course);
    assert_eq!(err, Error::TooManyEntries { folder: "slides", limit: 10_000 });
    assert_eq!(err.code(), ErrorCode::InvalidArgument);
}

// Apple file systems (APFS, HFS+) refuse names that are not UTF-8 (`EILSEQ`, "Illegal byte
// sequence"), so on macOS the fixture can't exist and no listing can ever meet such a name.
#[cfg(all(unix, not(target_vendor = "apple")))]
#[test]
fn names_that_are_not_unicode_are_left_out() {
    use std::os::unix::ffi::OsStrExt;
    let env = env();
    let course = mkdir(env.home(), "c");
    let slides = mkdir(&course, "slides");
    let bad = std::ffi::OsStr::from_bytes(b"bad-\xff.pdf");
    std::fs::write(slides.join(bad), "x").unwrap_or_else(|e| panic!("{e}"));
    touch(&course, "slides/good.pdf");
    assert_eq!(open_ok(&course).slides, vec![file("slides", "good.pdf")]);
}

#[test]
fn the_listing_serialises_with_the_contract_keys() {
    let listing = CourseListing {
        path: "/c/STAT311".into(),
        name: "STAT311".into(),
        lectures: vec![
            lecture("l01.md"),
            LectureFile { name: "l02.md".into(), path: "lectures/l02.md".into(), date: Some("2026-10-23".into()) },
        ],
        slides: vec![],
        sources: vec![file("sources", "book.pdf")],
    };
    let json = serde_json::to_value(&listing).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(
        json,
        serde_json::json!({
            "path": "/c/STAT311",
            "name": "STAT311",
            "lectures": [
                { "name": "l01.md", "path": "lectures/l01.md", "date": null },
                { "name": "l02.md", "path": "lectures/l02.md", "date": "2026-10-23" },
            ],
            "slides": [],
            "sources": [{ "name": "book.pdf", "path": "sources/book.pdf" }],
        })
    );
}

#[test]
fn windows_verbatim_prefixes_are_dropped_from_the_shown_path() {
    assert_eq!(plain(r"\\?\C:\Courses\STAT311"), r"C:\Courses\STAT311");
    assert_eq!(plain(r"\\?\UNC\server\share\STAT311"), r"\\server\share\STAT311");
    // Verbatim paths without a drive letter have no plain form; they stay as they are.
    assert_eq!(plain(r"\\?\Volume{1234}\STAT311"), r"\\?\Volume{1234}\STAT311");
    assert_eq!(plain("/home/a/STAT311"), "/home/a/STAT311");
    assert_eq!(plain(r"\\server\share\STAT311"), r"\\server\share\STAT311");
}

// --- containment (SEC-35) ---------------------------------------------------------------------

#[test]
fn within_accepts_the_root_and_paths_below_it_only() {
    let root = Path::new("/courses/STAT311");
    assert!(within(root, root));
    assert!(within(root, Path::new("/courses/STAT311/slides/07.pdf")));
    assert!(!within(root, Path::new("/courses/STAT3110/slides/07.pdf")), "a sibling sharing the prefix");
    assert!(!within(root, Path::new("/courses")));
    assert!(!within(root, Path::new("/etc/passwd")));
    assert!(!within(root, Path::new("/courses/STAT311/slides/../../../etc/passwd")), "..");
    assert!(!within(root, Path::new("/courses/STAT311/..")), "..");
    assert!(!within(root, Path::new("slides/07.pdf")), "relative");
}

#[cfg(windows)]
#[test]
fn within_handles_windows_separators_and_unc_paths() {
    let root = Path::new(r"C:\Courses\STAT311");
    assert!(within(root, Path::new(r"C:\Courses\STAT311\slides\07.pdf")));
    assert!(within(root, Path::new("C:/Courses/STAT311/slides/07.pdf")));
    assert!(!within(root, Path::new(r"C:\Courses\STAT311\..\Other\x.pdf")));
    assert!(!within(root, Path::new(r"D:\Courses\STAT311\x.pdf")));
    let unc = Path::new(r"\\server\share\STAT311");
    assert!(within(unc, Path::new(r"\\server\share\STAT311\slides\x.pdf")));
    assert!(!within(unc, Path::new(r"\\server\other\STAT311\slides\x.pdf")));
}

/// Windows separators are ordinary characters on Unix: a name with `\..\` stays one component
/// inside the course, so it can't climb out.
#[cfg(unix)]
#[test]
fn within_treats_backslashes_as_part_of_a_name_on_unix() {
    let root = Path::new("/courses/STAT311");
    assert!(within(root, Path::new(r"/courses/STAT311/slides\..\..\etc")));
    assert!(!within(root, Path::new(r"\\server\share\STAT311\slides")));
}

/// The symlink fixture: a slide file linked to a file outside the course. Since D-167 (F-047) it
/// belongs to the course and is listed under its own name, not refused.
#[test]
fn a_slide_linked_outside_the_course_is_listed() {
    let env = env();
    let week3 = touch(env.home(), "Downloads/week3.pdf");
    let course = mkdir(env.home(), "c");
    mkdir(&course, "slides");
    touch(&course, "slides/ok.pdf");
    link(&week3, &course.join("slides/07-covariance.pdf"));
    assert_eq!(open_ok(&course).slides, vec![file("slides", "07-covariance.pdf"), file("slides", "ok.pdf")]);
}

#[test]
fn a_lecture_linked_outside_the_course_is_not_trusted() {
    let env = env();
    let elsewhere = touch(env.home(), "other/l01.md");
    let course = mkdir(env.home(), "c");
    mkdir(&course, "lectures");
    link(&elsewhere, &course.join("lectures/l01.md"));
    assert_eq!(open_err(&course), Error::OutsideCourse("lectures/l01.md".into()));
}

#[test]
fn a_slides_folder_linked_outside_the_course_is_not_trusted() {
    let env = env();
    let outside = mkdir(env.home(), "Downloads");
    touch(&outside, "07.pdf");
    let course = mkdir(env.home(), "c");
    link(&outside, &course.join("slides"));
    let err = open_err(&course);
    assert_eq!(err, Error::OutsideCourse("slides".into()));
    assert_eq!(err.code(), ErrorCode::NotTrusted);
}

/// A folder inside slides/ linked outside lists the files directly in it (D-167, F-047).
#[test]
fn a_folder_inside_slides_linked_outside_lists_its_files() {
    let env = env();
    let outside = mkdir(env.home(), "elsewhere");
    touch(&outside, "08.pdf");
    let course = mkdir(env.home(), "c");
    mkdir(&course, "slides");
    link(&outside, &course.join("slides/more"));
    assert_eq!(open_ok(&course).slides, vec![file("slides", "more/08.pdf")]);
}

#[test]
fn a_link_that_stays_inside_the_course_is_listed_under_its_own_name() {
    let env = env();
    let course = mkdir(env.home(), "c");
    let book = touch(&course, "sources/book.pdf");
    mkdir(&course, "slides");
    link(&book, &course.join("slides/reading.pdf"));
    let materials = mkdir(&course, "materials");
    touch(&materials, "l01.md");
    link(&materials, &course.join("lectures"));
    let listing = open_ok(&course);
    assert_eq!(listing.slides, vec![file("slides", "reading.pdf")]);
    assert_eq!(listing.lectures, vec![lecture("l01.md")]);
}

#[test]
fn a_dangling_link_is_left_out() {
    let env = env();
    let course = mkdir(env.home(), "c");
    mkdir(&course, "slides");
    let gone = touch(env.home(), "gone.pdf");
    link(&gone, &course.join("slides/gone.pdf"));
    std::fs::remove_file(&gone).unwrap_or_else(|e| panic!("{e}"));
    touch(&course, "slides/here.pdf");
    assert_eq!(open_ok(&course).slides, vec![file("slides", "here.pdf")]);
}

#[test]
fn a_hidden_link_out_of_the_course_is_never_followed() {
    let env = env();
    let secret = touch(env.home(), "outside/secret.pdf");
    let course = mkdir(env.home(), "c");
    mkdir(&course, "slides");
    link(&secret, &course.join("slides/.cache.pdf"));
    assert!(open_ok(&course).slides.is_empty());
}

/// A link is judged by what it points at, so a link to a file is not a course folder.
#[test]
fn a_linked_file_is_not_a_course_folder() {
    let env = env();
    let notes = touch(env.home(), "notes.md");
    let looks_like_a_course = env.home().join("Looks Like A Course");
    link(&notes, &looks_like_a_course);
    assert_eq!(open_err(&looks_like_a_course), Error::NotAFolder);
}

/// A subfolder or entry that can't be resolved for any reason but "missing" (here a link loop) is
/// a file-system error, not an empty folder or a skipped file.
#[cfg(unix)]
#[test]
fn a_link_loop_is_an_io_error_not_an_empty_listing() {
    let env = env();
    let course = mkdir(env.home(), "c");
    link(&course.join("slides"), &course.join("slides"));
    let err = open_err(&course);
    assert!(matches!(err, Error::Io(_)), "{err:?}");
    assert_eq!(err.code(), ErrorCode::Io);

    let other = mkdir(env.home(), "d");
    let lectures = mkdir(&other, "lectures");
    link(&lectures.join("loop.md"), &lectures.join("loop.md"));
    let err = open_err(&other);
    assert!(matches!(err, Error::Io(_)), "{err:?}");
}

/// The course root itself may be a link (the user picked it); it opens as its target.
#[test]
fn a_linked_course_root_opens_as_its_target() {
    let env = env();
    let real = mkdir(env.home(), "Real Course");
    touch(&real, "slides/01.pdf");
    let shortcut = env.home().join("Shortcut");
    link(&real, &shortcut);
    let listing = open_ok(&shortcut);
    assert_eq!(listing.path, shown(&real));
    assert_eq!(listing.name, "Real Course");
    assert_eq!(listing.slides, vec![file("slides", "01.pdf")]);
}
