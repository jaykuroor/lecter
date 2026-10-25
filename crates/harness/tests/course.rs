//! F-018 criteria 2 and 4: `lecter-harness course open <dir>` prints a course folder's
//! `lectures/` and `slides/` listing as JSON (the app's `course_open` answer without `trust`), and a
//! symlink out of the course fails with E_NOT_TRUSTED.

#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::path::Path;
use std::process::{Command, Output};

use lecter_core::testenv::TestEnv;
use serde_json::{Value, json};

fn env() -> TestEnv {
    TestEnv::new().unwrap_or_else(|e| panic!("test home: {e}"))
}

/// Runs the harness in `cwd` with the test home applied.
fn harness(env: &TestEnv, cwd: &Path, args: &[&str]) -> Output {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_lecter-harness"));
    env.apply(&mut cmd).current_dir(cwd).args(args);
    cmd.output().unwrap_or_else(|e| panic!("run lecter-harness: {e}"))
}

fn one_json(out: &Output) -> Value {
    let text = std::str::from_utf8(&out.stdout).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(text.lines().count(), 1, "{text:?}");
    serde_json::from_str(text.trim_end()).unwrap_or_else(|e| panic!("not JSON ({e}): {text:?}"))
}

fn touch(dir: &Path, rel: &str) {
    let p = dir.join(rel);
    std::fs::create_dir_all(p.parent().unwrap_or(dir)).unwrap_or_else(|e| panic!("{e}"));
    std::fs::write(&p, "synthetic").unwrap_or_else(|e| panic!("{e}"));
}

/// A synthetic course: two lectures, two slide decks, a source and some files that aren't listed.
fn sample_course(env: &TestEnv) -> std::path::PathBuf {
    let course = env.home().join("Sample Course");
    for rel in [
        "lectures/2026-09-09-l02-probability.md",
        "lectures/2026-09-02-l01-introduction.md",
        "lectures/assets/l01/fig.svg",
        "slides/02-probability.pdf",
        "slides/01-introduction.pptx",
        "slides/.hidden.pdf",
        "sources/book.pdf",
        "course.md",
    ] {
        touch(&course, rel);
    }
    course
}

/// The canonical path as the listing shows it: on Windows without the `\\?\` verbatim prefix
/// (the temp dir is on a drive, never a UNC share).
fn canonical(p: &Path) -> String {
    let c = std::fs::canonicalize(p).unwrap_or_else(|e| panic!("{e}")).to_string_lossy().into_owned();
    c.strip_prefix(r"\\?\").map_or(c.clone(), str::to_owned)
}

#[test]
fn course_open_prints_the_listing_as_json() {
    let env = env();
    let course = sample_course(&env);
    let out = harness(&env, env.home(), &["course", "open", &course.to_string_lossy(), "--json"]);
    assert!(out.status.success(), "exit {:?}: {}", out.status.code(), String::from_utf8_lossy(&out.stdout));
    assert_eq!(
        one_json(&out),
        json!({
            "path": canonical(&course),
            "name": "Sample Course",
            "lectures": [
                { "name": "2026-09-02-l01-introduction.md", "path": "lectures/2026-09-02-l01-introduction.md" },
                { "name": "2026-09-09-l02-probability.md", "path": "lectures/2026-09-09-l02-probability.md" },
            ],
            "slides": [
                { "name": "01-introduction.pptx", "path": "slides/01-introduction.pptx" },
                { "name": "02-probability.pdf", "path": "slides/02-probability.pdf" },
            ],
        })
    );
}

#[test]
fn a_relative_folder_is_resolved_against_the_working_directory() {
    let env = env();
    let course = sample_course(&env);
    let out = harness(&env, env.home(), &["--json", "course", "open", "Sample Course"]);
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stdout));
    assert_eq!(one_json(&out)["path"], canonical(&course));
}

#[test]
fn course_open_without_json_prints_the_listing_as_text() {
    let env = env();
    let course = sample_course(&env);
    let out = harness(&env, env.home(), &["course", "open", &course.to_string_lossy()]);
    assert!(out.status.success());
    let text = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        text,
        format!(
            "Sample Course ({})\nlectures: 2\n  lectures/2026-09-02-l01-introduction.md\n  \
             lectures/2026-09-09-l02-probability.md\nslides: 2\n  slides/01-introduction.pptx\n  \
             slides/02-probability.pdf\n",
            canonical(&course)
        )
    );
}

#[test]
fn a_missing_folder_is_not_found() {
    let env = env();
    let out = harness(&env, env.home(), &["course", "open", "nowhere", "--json"]);
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(one_json(&out)["error"]["code"], "E_NOT_FOUND");
}

/// The symlink fixture: a slide linked to a file outside the course.
#[cfg(unix)]
#[test]
fn a_slide_linked_outside_the_course_is_not_trusted() {
    let env = env();
    let course = sample_course(&env);
    touch(env.home(), "private/secret.pdf");
    std::os::unix::fs::symlink(env.home().join("private/secret.pdf"), course.join("slides/03-leak.pdf"))
        .unwrap_or_else(|e| panic!("{e}"));
    let out = harness(&env, env.home(), &["course", "open", &course.to_string_lossy(), "--json"]);
    assert_eq!(out.status.code(), Some(1));
    let v = one_json(&out);
    assert_eq!(v["error"]["code"], "E_NOT_TRUSTED", "{v}");
    assert_eq!(v["error"]["retryable"], false);
    let msg = v["error"]["message"].as_str().unwrap_or_default();
    assert!(msg.starts_with("slides/03-leak.pdf points outside the course folder"), "{msg}");
}
