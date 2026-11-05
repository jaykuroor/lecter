//! F-034: the course details form's first values, saving them to `.lecter/course.jsonc` with
//! `"version": 1`, and what saving must not do: write for a read-only course, lose the file's other
//! content, or change the trust fingerprint (so the user isn't asked to trust again).

#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use super::*;
use crate::ErrorCode;
use crate::course::trust::{TrustChoice, TrustState, decide, review, state};
use crate::course::{open, trust::TrustStore};
use crate::testenv::TestEnv;

fn env() -> TestEnv {
    TestEnv::new().unwrap_or_else(|e| panic!("{e}"))
}

fn write(dir: &Path, rel: &str, text: &str) -> PathBuf {
    let p = dir.join(rel);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).unwrap_or_else(|e| panic!("{e}"));
    }
    std::fs::write(&p, text).unwrap_or_else(|e| panic!("{e}"));
    p
}

fn read(course: &Path) -> String {
    std::fs::read_to_string(course.join(".lecter/course.jsonc")).unwrap_or_else(|e| panic!("{e}"))
}

fn parsed(course: &Path) -> Value {
    jsonc::parse(&read(course)).unwrap_or_else(|e| panic!("{e}"))
}

/// A course folder with the spec's subfolders.
fn course(env: &TestEnv, name: &str) -> PathBuf {
    let c = env.home().join(name);
    write(&c, "lectures/l01.md", "::: {.slide #s1 n=1}\n:::\n");
    write(&c, "slides/01.pdf", "x");
    write(&c, "sources/past-papers/2025.pdf", "x");
    c
}

fn answer(store: &TrustStore, course: &Path, choice: TrustChoice) {
    let listing = open(course).unwrap_or_else(|e| panic!("{e:?}"));
    let r = review(store, &listing, "Sample (offline)").unwrap_or_else(|e| panic!("{e:?}"));
    decide(store, &listing.path, choice, &r.fingerprint).unwrap_or_else(|e| panic!("{e:?}"));
}

fn trusted(env: &TestEnv, course: &Path) -> TrustStore {
    let store = TrustStore::new(&env.dirs());
    answer(&store, course, TrustChoice::Trusted);
    store
}

/// The spec's example (02-course-folder.md#course-details-coursejsonc).
fn example() -> CourseDetails {
    CourseDetails {
        name: "Probability and Statistics".into(),
        code: "STAT 311".into(),
        term: "Fall 2026".into(),
        professor: "Dr. Rivera".into(),
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

fn saved(store: &TrustStore, course: &Path, details: &CourseDetails) -> CourseDetails {
    save(store, course, details).unwrap_or_else(|e| panic!("{e:?}"))
}

fn refused(store: &TrustStore, course: &Path, details: &CourseDetails) -> Error {
    match save(store, course, details) {
        Ok(d) => panic!("saved {d:?}"),
        Err(e) => e,
    }
}

/// Criterion 1: a new course's form is pre-filled from its folder names.
#[test]
fn a_new_course_starts_from_its_folder_names() {
    let env = env();
    let c = course(&env, "STAT311 - Probability and Statistics (Fall 2026)");
    let form = pending(&c).unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(form, Some(CourseDetails { professor: String::new(), ..example() }));
}

/// SEC-35: a `sources` link out of the course isn't looked into for past papers; the mapping
/// keeps the spec's names.
#[cfg(unix)]
#[test]
fn a_sources_link_out_of_the_course_is_not_looked_into() {
    let env = env();
    let c = env.home().join("Linear Algebra");
    write(&c, "lectures/l.md", "x");
    let outside = env.home().join("elsewhere");
    write(&outside, "Exams/2024.pdf", "x");
    std::os::unix::fs::symlink(&outside, c.join("sources")).unwrap_or_else(|e| panic!("{e}"));
    let form = pending(&c).unwrap_or_else(|e| panic!("{e:?}")).unwrap_or_else(|| panic!("no form"));
    assert_eq!((form.folders.sources.as_str(), form.folders.past_papers.as_str()), ("sources", "sources/past-papers"));
    // The same folder inside the course is found.
    std::fs::remove_file(c.join("sources")).unwrap_or_else(|e| panic!("{e}"));
    write(&c, "sources/Exams/2024.pdf", "x");
    let form = pending(&c).unwrap_or_else(|e| panic!("{e:?}")).unwrap_or_else(|| panic!("no form"));
    assert_eq!(form.folders.past_papers, "sources/Exams");
}

/// Criterion 1: the folder mapping follows the course's own spelling of its folders.
#[test]
fn the_folder_mapping_uses_the_folders_the_course_has() {
    let env = env();
    let c = env.home().join("Linear Algebra");
    for rel in ["Slides/a.pdf", "Lectures/l.md", "Sources/Past Papers/2024.pdf"] {
        write(&c, rel, "x");
    }
    let form = pending(&c).unwrap_or_else(|e| panic!("{e:?}")).unwrap_or_else(|| panic!("no form"));
    assert_eq!(
        form.folders,
        CourseFolders {
            slides: "Slides".into(),
            sources: "Sources".into(),
            lectures: "Lectures".into(),
            past_papers: "Sources/Past Papers".into(),
        }
    );
    assert_eq!((form.name.as_str(), form.code.as_str(), form.icon.as_str()), ("Linear Algebra", "", "L"));
}

/// Criterion 1: what `course.jsonc` already holds (a hand-written name, its settings) wins over the
/// guesses, until details are saved.
#[test]
fn values_already_in_the_file_win_over_guesses() {
    let env = env();
    let c = course(&env, "STAT311");
    write(
        &c,
        ".lecter/course.jsonc",
        r##"{ "name": "Stats", "color": "#ff0000", "folders": { "slides": "decks" }, "settings": {} }"##,
    );
    let form = pending(&c).unwrap_or_else(|e| panic!("{e:?}")).unwrap_or_else(|| panic!("no form"));
    assert_eq!(form.name, "Stats");
    assert_eq!(form.code, "STAT 311");
    assert_eq!(form.color, "#ff0000");
    assert_eq!(form.folders.slides, "decks");
    assert_eq!(form.folders.lectures, "lectures");
}

/// Criterion 2: saving writes `.lecter/course.jsonc` with `"version": 1` and every field, and the
/// form isn't offered again.
#[test]
fn saving_writes_course_jsonc_with_version_1() {
    let env = env();
    let c = course(&env, "STAT311");
    let store = trusted(&env, &c);
    assert_eq!(saved(&store, &c, &example()), example());
    assert_eq!(
        parsed(&c),
        json!({
            "version": 1,
            "name": "Probability and Statistics",
            "code": "STAT 311",
            "term": "Fall 2026",
            "professor": "Dr. Rivera",
            "icon": "S",
            "color": "#3584e4",
            "folders": { "slides": "slides", "sources": "sources", "lectures": "lectures", "pastPapers": "sources/past-papers" }
        })
    );
    assert!(read(&c).trim_start().starts_with("{\n  \"version\": 1,"), "{}", read(&c));
    assert_eq!(pending(&c).unwrap_or_else(|e| panic!("{e:?}")), None);
}

/// Criterion 2: saving edits the file in place: comments, settings and unknown keys stay.
#[test]
fn saving_keeps_the_rest_of_the_file() {
    let env = env();
    let c = course(&env, "STAT311");
    let before = "{\n  // the professor's nickname for it\n  \"name\": \"Stats\",\n  \"mascot\": \"owl\",\n  \"settings\": { \"ui\": { \"performance\": \"quality\" } }\n}\n";
    write(&c, ".lecter/course.jsonc", before);
    let store = trusted(&env, &c);
    saved(&store, &c, &example());
    let text = read(&c);
    assert!(text.contains("// the professor's nickname for it"), "{text}");
    let v = parsed(&c);
    assert_eq!(v["name"], "Probability and Statistics");
    assert_eq!(v["mascot"], "owl");
    assert_eq!(v["settings"], json!({ "ui": { "performance": "quality" } }));
    assert_eq!(v["version"], 1);
}

/// Saving details doesn't change the trust fingerprint, so the course stays trusted: with no
/// `course.jsonc` before, and with one holding settings overrides.
#[test]
fn saving_details_keeps_the_course_trusted() {
    let env = env();
    for (name, file) in [
        ("New", None),
        ("Overrides", Some(r#"{ "settings": { "ui": { "performance": "quality" } } }"#)),
        ("Empty settings", Some(r#"{ "settings": {} }"#)),
    ] {
        let c = course(&env, name);
        if let Some(text) = file {
            write(&c, ".lecter/course.jsonc", text);
        }
        let store = trusted(&env, &c);
        saved(&store, &c, &example());
        assert_eq!(state(&store, &c).unwrap_or_else(|e| panic!("{e:?}")), TrustState::Trusted, "{name}");
        let again = CourseDetails { name: "Renamed".into(), color: "#00ff00".into(), ..example() };
        saved(&store, &c, &again);
        assert_eq!(state(&store, &c).unwrap_or_else(|e| panic!("{e:?}")), TrustState::Trusted, "{name}, twice");
    }
}

/// A read-only or unanswered course gets no form saved, and its folder no `course.jsonc`.
#[test]
fn a_read_only_or_untrusted_course_is_never_written() {
    let env = env();
    let c = course(&env, "STAT311");
    let store = TrustStore::new(&env.dirs());
    let e = refused(&store, &c, &example());
    assert_eq!((e.clone(), e.code()), (Error::CourseNotTrusted, ErrorCode::NotTrusted));
    answer(&store, &c, TrustChoice::ReadOnly);
    let e = refused(&store, &c, &example());
    assert_eq!((e.clone(), e.code()), (Error::CourseReadOnly, ErrorCode::NotTrusted));
    assert!(!c.join(".lecter").exists(), "a refused save created .lecter/");
}

/// A file Lecter can't edit is left as it is, and the error says why.
#[test]
fn a_broken_or_newer_file_is_left_alone() {
    let env = env();
    let c = course(&env, "STAT311");
    let store = trusted(&env, &c);
    let broken = "{ \"name\": \"Stats\" \n";
    write(&c, ".lecter/course.jsonc", broken);
    // A broken file changes the fingerprint, so trust again as it is now.
    answer(&store, &c, TrustChoice::Trusted);
    let e = refused(&store, &c, &example());
    assert!(matches!(e, Error::CourseFileUnusable { .. }), "{e:?}");
    assert!(e.to_string().starts_with(".lecter/course.jsonc is not valid JSONC"), "{e}");
    assert_eq!(read(&c), broken);

    let newer = r#"{ "version": 2, "name": "Stats" }"#;
    write(&c, ".lecter/course.jsonc", newer);
    answer(&store, &c, TrustChoice::Trusted);
    let e = refused(&store, &c, &example());
    assert_eq!(e, Error::CourseFileNewer { path: FILE.into(), version: "2".into() });
    assert_eq!(read(&c), newer);
    // Saved details (any version) mean the form isn't offered.
    assert_eq!(pending(&c).unwrap_or_else(|e| panic!("{e:?}")), None);
}

/// What the form sends is checked before anything is written; each field says what is wrong.
#[test]
fn bad_details_are_refused_with_the_reason() {
    let env = env();
    let c = course(&env, "STAT311");
    let store = trusted(&env, &c);
    let long = "x".repeat(check::MAX_TEXT_CHARS + 1);
    let with = |f: fn(&mut CourseDetails)| {
        let mut d = example();
        f(&mut d);
        d
    };
    let cases: Vec<(CourseDetails, &str)> = vec![
        (with(|d| d.name = "   ".into()), "Give the course a name."),
        (CourseDetails { professor: long, ..example() }, "The professor is longer than 200 characters."),
        (with(|d| d.term = "Fall\n2026".into()), "The term can't hold line breaks or control characters."),
        (with(|d| d.color = "blue".into()), "The colour must be written #rrggbb, e.g. #3584e4."),
        (with(|d| d.color = "#3584e".into()), "The colour must be written #rrggbb, e.g. #3584e4."),
        (with(|d| d.color = "#3584eg".into()), "The colour must be written #rrggbb, e.g. #3584e4."),
        (
            with(|d| d.icon = String::new()),
            "The icon is a letter (up to 8 characters) or an image in .lecter/, e.g. .lecter/icon.png.",
        ),
        (
            with(|d| d.icon = "STATISTIC".into()),
            "The icon is a letter (up to 8 characters) or an image in .lecter/, e.g. .lecter/icon.png.",
        ),
        (
            with(|d| d.icon = "S T".into()),
            "The icon is a letter (up to 8 characters) or an image in .lecter/, e.g. .lecter/icon.png.",
        ),
        (with(|d| d.icon = ".lecter/icon.png".into()), ".lecter/icon.png is not an image file in .lecter/."),
        (with(|d| d.icon = ".lecter/icon.svg".into()), "The icon must be a png, jpg, jpeg, webp, gif image."),
        (
            with(|d| d.icon = ".lecter/../x.png".into()),
            "The icon must be a path inside the course, like sources/past-papers.",
        ),
        (
            with(|d| d.folders.slides = "../slides".into()),
            "The slides must be a path inside the course, like sources/past-papers.",
        ),
        (
            with(|d| d.folders.sources = "/etc".into()),
            "The sources must be a path inside the course, like sources/past-papers.",
        ),
        (
            with(|d| d.folders.lectures = "C:\\notes".into()),
            "The lectures must be a path inside the course, like sources/past-papers.",
        ),
        (
            with(|d| d.folders.past_papers = "sources//old".into()),
            "The past papers must be a path inside the course, like sources/past-papers.",
        ),
        (
            with(|d| d.folders.past_papers = "./sources".into()),
            "The past papers must be a path inside the course, like sources/past-papers.",
        ),
        (
            with(|d| d.folders.slides = String::new()),
            "The slides must be a path inside the course, like sources/past-papers.",
        ),
        (with(|d| d.folders.slides = "slides/01.pdf".into()), "The slides folder, slides/01.pdf, is a file."),
        (
            with(|d| d.folders.lectures = "C:notes".into()),
            "The lectures must be a path inside the course, like sources/past-papers.",
        ),
        (
            CourseDetails {
                folders: CourseFolders { slides: "x".repeat(check::MAX_PATH_BYTES + 1), ..example().folders },
                ..example()
            },
            "The slides must be a path inside the course, like sources/past-papers.",
        ),
    ];
    for (details, message) in cases {
        let e = refused(&store, &c, &details);
        assert_eq!((e.to_string(), e.code()), (message.to_owned(), ErrorCode::InvalidArgument), "{details:?}");
    }
    assert!(!c.join(".lecter/course.jsonc").exists(), "a refused save wrote the file");
    let max = "x".repeat(check::MAX_TEXT_CHARS);
    let longest = "x".repeat(check::MAX_PATH_BYTES);
    let edge = CourseDetails {
        professor: max.clone(),
        icon: "ABCDEFGH".into(),
        folders: CourseFolders { slides: longest.clone(), ..example().folders },
        ..example()
    };
    let out = saved(&store, &c, &edge);
    assert_eq!((out.professor, out.folders.slides), (max, longest));
}

/// Text is trimmed, the colour lower-cased, a trailing `/` dropped; a mapped folder may not exist
/// yet; an image icon in `.lecter/` is kept as its path.
#[test]
fn details_are_saved_tidied() {
    let env = env();
    let c = course(&env, "STAT311");
    write(&c, ".lecter/icon.png", "png");
    let store = trusted(&env, &c);
    let mut d = example();
    d.name = "  Probability and Statistics ".into();
    d.color = "#3584E4".into();
    d.icon = ".lecter/icon.png".into();
    d.folders.slides = "slides/".into();
    d.folders.past_papers = "sources/exams".into();
    let out = saved(&store, &c, &d);
    assert_eq!(out.name, "Probability and Statistics");
    assert_eq!(out.color, "#3584e4");
    assert_eq!(out.icon, ".lecter/icon.png");
    assert_eq!(out.folders.slides, "slides");
    assert_eq!(out.folders.past_papers, "sources/exams");
    assert_eq!(parsed(&c)["folders"]["pastPapers"], "sources/exams");
}

/// SEC-35: a mapped folder or icon that leads out of the course through a link is refused.
#[cfg(unix)]
#[test]
fn links_out_of_the_course_are_refused() {
    let env = env();
    let c = course(&env, "STAT311");
    let outside = env.home().join("elsewhere");
    write(&outside, "icon.png", "png");
    std::os::unix::fs::symlink(&outside, c.join("decks")).unwrap_or_else(|e| panic!("{e}"));
    std::fs::create_dir_all(c.join(".lecter")).unwrap_or_else(|e| panic!("{e}"));
    std::os::unix::fs::symlink(outside.join("icon.png"), c.join(".lecter/icon.png")).unwrap_or_else(|e| panic!("{e}"));
    std::os::unix::fs::symlink(env.home().join("nowhere"), c.join("gone")).unwrap_or_else(|e| panic!("{e}"));
    let store = trusted(&env, &c);
    for (details, rel) in [
        (
            CourseDetails { folders: CourseFolders { slides: "decks".into(), ..example().folders }, ..example() },
            "decks",
        ),
        (
            CourseDetails {
                folders: CourseFolders { past_papers: "decks/old".into(), ..example().folders },
                ..example()
            },
            "decks/old",
        ),
        (
            CourseDetails { folders: CourseFolders { lectures: "gone".into(), ..example().folders }, ..example() },
            "gone",
        ),
        (CourseDetails { icon: ".lecter/icon.png".into(), ..example() }, ".lecter/icon.png"),
    ] {
        let e = refused(&store, &c, &details);
        assert_eq!((e.clone(), e.code()), (Error::OutsideCourse(rel.into()), ErrorCode::NotTrusted), "{rel}");
    }
    // A link in .lecter/ to an image elsewhere in the course isn't an image in .lecter/.
    write(&c, "slides/logo.png", "png");
    std::os::unix::fs::symlink(c.join("slides/logo.png"), c.join(".lecter/logo.png")).unwrap_or_else(|e| panic!("{e}"));
    let e = refused(&store, &c, &CourseDetails { icon: ".lecter/logo.png".into(), ..example() });
    assert_eq!(e, Error::BadDetails(".lecter/logo.png is not an image file in .lecter/.".into()));
}

/// SEC-35: a `course.jsonc` (or `.lecter/`) that is a link out of the course is never written
/// through.
#[cfg(unix)]
#[test]
fn a_course_file_linked_out_is_not_written_through() {
    let env = env();
    let c = course(&env, "STAT311");
    let outside = write(&env.home().join("elsewhere"), "course.jsonc", "{}");
    std::fs::create_dir_all(c.join(".lecter")).unwrap_or_else(|e| panic!("{e}"));
    std::os::unix::fs::symlink(&outside, c.join(".lecter/course.jsonc")).unwrap_or_else(|e| panic!("{e}"));
    let store = trusted(&env, &c);
    let e = refused(&store, &c, &example());
    assert_eq!(e, Error::OutsideCourse(FILE.into()));
    assert_eq!(std::fs::read_to_string(&outside).unwrap_or_else(|e| panic!("{e}")), "{}");

    let d = course(&env, "Linked");
    std::os::unix::fs::symlink(env.home().join("elsewhere"), d.join(".lecter")).unwrap_or_else(|e| panic!("{e}"));
    let store = trusted(&env, &d);
    let e = refused(&store, &d, &example());
    assert_eq!(e, Error::OutsideCourse(".lecter".into()));
    assert_eq!(std::fs::read_to_string(&outside).unwrap_or_else(|e| panic!("{e}")), "{}");
}
