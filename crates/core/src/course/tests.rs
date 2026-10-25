//! F-018: opening a course folder and listing `lectures/` and `slides/` (02-course-folder.md),
//! with canonical paths and symlinks out of the course rejected with E_NOT_TRUSTED (SEC-35).

#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::path::{Path, PathBuf};

use super::*;
use crate::ErrorCode;
use crate::testenv::TestEnv;

fn env() -> TestEnv {
    TestEnv::new().unwrap_or_else(|e| panic!("{e}"))
}

/// Creates `rel` under `dir` (and its parents) as a small file.
fn touch(dir: &Path, rel: &str) -> PathBuf {
    let p = dir.join(rel);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).unwrap_or_else(|e| panic!("{e}"));
    }
    std::fs::write(&p, "x").unwrap_or_else(|e| panic!("{e}"));
    p
}

fn mkdir(dir: &Path, rel: &str) -> PathBuf {
    let p = dir.join(rel);
    std::fs::create_dir_all(&p).unwrap_or_else(|e| panic!("{e}"));
    p
}

fn canonical(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|e| panic!("{e}"))
}

fn file(dir: &str, name: &str) -> CourseFile {
    CourseFile { name: name.to_owned(), path: format!("{dir}/{name}") }
}

#[cfg(unix)]
fn link(target: &Path, at: &Path) {
    std::os::unix::fs::symlink(target, at).unwrap_or_else(|e| panic!("{e}"));
}

#[cfg(windows)]
fn link(target: &Path, at: &Path) {
    let made = if target.is_dir() {
        std::os::windows::fs::symlink_dir(target, at)
    } else {
        std::os::windows::fs::symlink_file(target, at)
    };
    made.unwrap_or_else(|e| panic!("symlinks need developer mode on Windows: {e}"));
}

fn open_ok(course: &Path) -> CourseListing {
    open(course).unwrap_or_else(|e| panic!("{e:?}"))
}

fn open_err(course: &Path) -> Error {
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
            path: canonical(&course).to_str().unwrap_or_else(|| panic!("utf-8")).to_owned(),
            name: "STAT311".into(),
            lectures: vec![
                file("lectures", "2026-09-02-l01-introduction.md"),
                file("lectures", "2026-09-09-l02-probability.md"),
            ],
            slides: vec![
                file("slides", "01-intro.pdf"),
                file("slides", "07-covariance.pdf"),
                file("slides", "07b-examples.pptx"),
            ],
        }
    );
}

#[test]
fn a_lecture_extension_in_capitals_is_still_markdown() {
    let env = env();
    let course = mkdir(env.home(), "c");
    touch(&course, "lectures/L01.MD");
    touch(&course, "lectures/md");
    touch(&course, "lectures/notes.mdx");
    assert_eq!(open_ok(&course).lectures, vec![file("lectures", "L01.MD")]);
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
    assert_eq!(listing.lectures, vec![file("lectures", "l01.md")]);
}

#[test]
fn the_path_is_canonical_even_when_picked_through_dots() {
    let env = env();
    let course = mkdir(env.home(), "Algebra 101");
    let via_dots = env.home().join("Algebra 101").join("..").join("Algebra 101");
    let listing = open_ok(&via_dots);
    assert_eq!(Path::new(&listing.path), canonical(&course));
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

#[cfg(unix)]
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
        lectures: vec![file("lectures", "l01.md")],
        slides: vec![],
    };
    let json = serde_json::to_value(&listing).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(
        json,
        serde_json::json!({
            "path": "/c/STAT311",
            "name": "STAT311",
            "lectures": [{ "name": "l01.md", "path": "lectures/l01.md" }],
            "slides": [],
        })
    );
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

/// The symlink fixture: a slide file linked to a file outside the course.
#[test]
fn a_slide_linked_outside_the_course_is_not_trusted() {
    let env = env();
    let secret = touch(env.home(), "outside/secret.pdf");
    let course = mkdir(env.home(), "c");
    mkdir(&course, "slides");
    touch(&course, "slides/ok.pdf");
    link(&secret, &course.join("slides/07-covariance.pdf"));
    let err = open_err(&course);
    assert_eq!(err, Error::OutsideCourse("slides/07-covariance.pdf".into()));
    assert_eq!(err.code(), ErrorCode::NotTrusted);
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

#[test]
fn a_folder_inside_slides_linked_outside_is_not_trusted() {
    let env = env();
    let outside = mkdir(env.home(), "elsewhere");
    let course = mkdir(env.home(), "c");
    mkdir(&course, "slides");
    link(&outside, &course.join("slides/more"));
    assert_eq!(open_err(&course), Error::OutsideCourse("slides/more".into()));
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
    assert_eq!(listing.lectures, vec![file("lectures", "l01.md")]);
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
    assert_eq!(Path::new(&listing.path), canonical(&real));
    assert_eq!(listing.name, "Real Course");
    assert_eq!(listing.slides, vec![file("slides", "01.pdf")]);
}
