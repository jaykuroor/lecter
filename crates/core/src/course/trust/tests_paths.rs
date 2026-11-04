//! F-033 criterion 4: the AI's file API ([`course_file`]) rejects every path outside the course
//! root after canonicalisation: `..`, symlinks out, UNC and drive paths, and Windows separators
//! (property test over a fixture with links in and out of the course).

#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::path::{Path, PathBuf};

use proptest::prelude::*;
use proptest::test_runner::{Config, TestCaseError, TestRunner};

use super::tests::link;
use super::*;
use crate::ErrorCode;
use crate::course::within;
use crate::testenv::TestEnv;

fn write(dir: &Path, rel: &str) -> PathBuf {
    let p = dir.join(rel);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).unwrap_or_else(|e| panic!("{e}"));
    }
    std::fs::write(&p, "x").unwrap_or_else(|e| panic!("{e}"));
    p
}

/// The fixture: `<home>/c` is the course; `<home>/outside` is not.
///
/// ```text
/// outside/secret.txt   outside/dir/x.txt
/// c/notes.md   c/a/f.txt   c/a/b/g.txt
/// c/up -> c/a          c/a/loop -> c        (links that stay inside)
/// c/out -> outside     c/a/esc.txt -> outside/secret.txt   (links out)
/// ```
fn fixture(env: &TestEnv) -> (PathBuf, PathBuf) {
    let home = env.home();
    let secret = write(home, "outside/secret.txt");
    write(home, "outside/dir/x.txt");
    let c = home.join("c");
    for rel in ["notes.md", "a/f.txt", "a/b/g.txt"] {
        write(&c, rel);
    }
    link(&c.join("a"), &c.join("up"));
    link(&c, &c.join("a/loop"));
    link(&home.join("outside"), &c.join("out"));
    link(&secret, &c.join("a/esc.txt"));
    (
        std::fs::canonicalize(&c).unwrap_or_else(|e| panic!("{e}")),
        std::fs::canonicalize(home.join("outside")).unwrap_or_else(|e| panic!("{e}")),
    )
}

fn env() -> TestEnv {
    TestEnv::new().unwrap_or_else(|e| panic!("{e}"))
}

/// Paths inside the course, however they are spelled, resolve to the real file.
#[test]
fn paths_inside_the_course_resolve_to_the_real_file() {
    let env = env();
    let (c, _) = fixture(&env);
    let cases = [
        ("notes.md", "notes.md"),
        ("a/f.txt", "a/f.txt"),
        ("a\\b\\g.txt", "a/b/g.txt"),
        ("./a//f.txt", "a/f.txt"),
        ("up/b/g.txt", "a/b/g.txt"),
        ("a/loop/a/loop/notes.md", "notes.md"),
        ("a/b", "a/b"),
    ];
    for (requested, want) in cases {
        let got = course_file(&c, requested).unwrap_or_else(|e| panic!("{requested}: {e:?}"));
        assert_eq!(got, std::fs::canonicalize(c.join(want)).unwrap_or_else(|e| panic!("{e}")), "{requested}");
    }
}

/// Each way out, written out once, is E_NOT_TRUSTED and names the requested path.
#[test]
fn each_way_out_is_not_trusted() {
    let env = env();
    let (c, outside) = fixture(&env);
    let abs = outside.join("secret.txt");
    let abs = abs.to_str().unwrap_or_else(|| panic!("utf-8"));
    for requested in [
        "../outside/secret.txt",
        "a/../../outside/secret.txt",
        "a\\..\\..\\outside\\secret.txt",
        "..\\c\\notes.md",
        "out/secret.txt",
        "out\\dir\\x.txt",
        "a/esc.txt",
        "/etc/passwd",
        "\\Windows\\win.ini",
        abs,
        "C:\\Windows\\win.ini",
        "C:notes.md",
        "c:/notes.md",
        "\\\\server\\share\\c\\notes.md",
        "//server/share/c/notes.md",
        "\\\\?\\C:\\c\\notes.md",
        "\\\\?\\UNC\\server\\share\\x",
        "notes.md:stream",
        "",
        ".",
        "./",
        "a/\0/f.txt",
    ] {
        let e = course_file(&c, requested).err().unwrap_or_else(|| panic!("{requested:?} was accepted"));
        assert_eq!(e.code(), ErrorCode::NotTrusted, "{requested:?}: {e:?}");
    }
    let e = course_file(&c, "out/secret.txt").err().unwrap_or_else(|| panic!("accepted"));
    assert_eq!(e, Error::OutsideCourse("out/secret.txt".into()));
}

/// A path inside that doesn't exist is a read failure (not found), not a way out; a path over
/// the length limit is refused.
#[test]
fn missing_and_overlong_paths() {
    let env = env();
    let (c, _) = fixture(&env);
    let e = course_file(&c, "a/missing.txt").err().unwrap_or_else(|| panic!("accepted"));
    assert_eq!(e, Error::ReadFailed { path: "a/missing.txt".into(), kind: std::io::ErrorKind::NotFound });
    let long = "a/".repeat(2048) + "f.txt";
    assert_eq!(course_file(&c, &long).map_err(|e| e.code()), Err(ErrorCode::NotTrusted));
}

/// The length limit is 4096 bytes: a path of exactly that is looked up (here: not found), one
/// byte more is refused.
#[test]
fn a_path_of_exactly_the_limit_is_looked_up() {
    let env = env();
    let (c, _) = fixture(&env);
    let at_limit = "a/".repeat(2045) + "ff.txt";
    assert_eq!(at_limit.len(), 4096);
    let e = course_file(&c, &at_limit).err().unwrap_or_else(|| panic!("accepted"));
    assert!(matches!(e, Error::ReadFailed { .. }), "{e:?}");
    let over = at_limit + "x";
    assert_eq!(course_file(&c, &over).err().map(|e| e.code()), Some(ErrorCode::NotTrusted));
}

/// A link to nowhere names a place, maybe outside the course: refused as escaping, not reported
/// as a missing file.
#[test]
fn a_dangling_link_is_refused_as_escaping() {
    let env = env();
    let (c, outside) = fixture(&env);
    link(&outside.join("gone.txt"), &c.join("a/gone.txt"));
    let e = course_file(&c, "a/gone.txt").err().unwrap_or_else(|| panic!("accepted"));
    assert_eq!(e, Error::OutsideCourse("a/gone.txt".into()));
}

/// One part of a generated path: names in the fixture (links in and out included), `.`, `..`,
/// empty parts, and drive-like names.
fn part() -> impl Strategy<Value = &'static str> {
    prop::sample::select(vec![
        "a",
        "b",
        "f.txt",
        "g.txt",
        "notes.md",
        "up",
        "loop",
        "out",
        "esc.txt",
        "outside",
        "secret.txt",
        "dir",
        "x.txt",
        "c",
        "..",
        ".",
        "",
        "C:",
        "c:x",
    ])
}

/// What a generated path may start with: nothing, a root, a drive, a UNC or verbatim prefix.
fn prefix() -> impl Strategy<Value = &'static str> {
    prop::sample::select(vec![
        "",
        "",
        "",
        "/",
        "\\",
        "C:\\",
        "C:/",
        "\\\\server\\share\\",
        "//server/share/",
        "\\\\?\\C:\\",
        "\\\\?\\UNC\\s\\x\\",
    ])
}

/// The property: whatever the AI asks for, an accepted path is the canonical path of something
/// under the course root, and never under `outside/`. Any path with a root or drive prefix, a
/// `..`, or a `:` is refused with E_NOT_TRUSTED, and any path through a link out never succeeds.
#[test]
fn no_generated_path_escapes_the_course() {
    let env = env();
    let (c, outside) = fixture(&env);
    let strategy = (prefix(), prop::collection::vec((part(), prop::bool::ANY), 1..7));
    let mut runner = TestRunner::new(Config { cases: 2048, failure_persistence: None, ..Config::default() });
    let result = runner.run(&strategy, |(prefix, parts)| {
        let mut requested = prefix.to_owned();
        for (i, (p, back)) in parts.iter().enumerate() {
            if i > 0 {
                requested.push(if *back { '\\' } else { '/' });
            }
            requested.push_str(p);
        }
        let got = course_file(&c, &requested);
        let names: Vec<&str> = parts.iter().map(|(p, _)| *p).collect();
        if let Ok(real) = &got {
            prop_assert!(within(&c, real), "{requested:?} → {}", real.display());
            prop_assert!(!real.starts_with(&outside), "{requested:?} → {}", real.display());
            prop_assert_eq!(real, &std::fs::canonicalize(real).map_err(|e| TestCaseError::fail(e.to_string()))?);
        }
        let lexically_out = !prefix.is_empty() || names.iter().any(|n| *n == ".." || n.contains(':'));
        if lexically_out {
            prop_assert_eq!(got.as_ref().map_err(Error::code).err(), Some(ErrorCode::NotTrusted), "{:?}", requested);
        }
        if names.iter().any(|n| *n == "out" || *n == "esc.txt") {
            prop_assert!(got.is_err(), "{requested:?} went through a link out");
        }
        Ok(())
    });
    if let Err(e) = result {
        panic!("{e}");
    }
}
