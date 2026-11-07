//! F-033: the trust screen's contents, `trusted.jsonc`, asking again when the folder moves or its
//! AI files change (SEC-25), and the core's read-only gate (SEC-27).

#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::path::{Path, PathBuf};

use super::*;
use crate::ErrorCode;
use crate::course::open;
use crate::testenv::TestEnv;

pub(super) fn env() -> TestEnv {
    TestEnv::new().unwrap_or_else(|e| panic!("{e}"))
}

pub(super) fn write(dir: &Path, rel: &str, text: &str) -> PathBuf {
    let p = dir.join(rel);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).unwrap_or_else(|e| panic!("{e}"));
    }
    std::fs::write(&p, text).unwrap_or_else(|e| panic!("{e}"));
    p
}

pub(super) fn store(env: &TestEnv) -> TrustStore {
    TrustStore::new(&env.dirs())
}

/// A course with 2 lectures, 3 slides, 3 sources (one in `past-papers/`, plus a hidden file that
/// doesn't count), an `AGENTS.md`, one role, one skill and two settings overrides.
pub(super) fn course(env: &TestEnv, name: &str) -> PathBuf {
    let c = env.home().join(name);
    for rel in ["lectures/l01.md", "lectures/l02.md"] {
        write(&c, rel, "::: {.slide #s1 n=1}\n:::\n");
    }
    for rel in ["slides/01.pdf", "slides/02.pdf", "slides/03.pptx"] {
        write(&c, rel, "x");
    }
    for rel in ["sources/book.pdf", "sources/paper.pdf", "sources/past-papers/2025.pdf", "sources/.DS_Store"] {
        write(&c, rel, "x");
    }
    write(&c, "AGENTS.md", "The professor writes E[X] for expectation.\n");
    write(&c, ".lecter/agents/tutor.md", "---\nname: tutor\n---\nBe brief.\n");
    write(&c, ".lecter/skills/flashcards/SKILL.md", "Make flashcards.\n");
    write(
        &c,
        ".lecter/course.jsonc",
        "{ \"name\": \"Stats\", \"settings\": { \"ui\": { \"performance\": \"quality\" }, \"ai\": { \"hedgeAfterMs\": 900 } } }",
    );
    c
}

pub(super) fn reviewed(store: &TrustStore, course: &Path) -> Review {
    let listing = open(course).unwrap_or_else(|e| panic!("{e:?}"));
    review(store, &listing, "Sample (offline)").unwrap_or_else(|e| panic!("{e:?}"))
}

pub(super) fn trust(store: &TrustStore, course: &Path, choice: TrustChoice) {
    let r = reviewed(store, course);
    let path = open(course).unwrap_or_else(|e| panic!("{e:?}")).path;
    decide(store, &path, choice, &r.fingerprint).unwrap_or_else(|e| panic!("{e:?}"));
}

pub(super) fn state_of(store: &TrustStore, course: &Path) -> TrustState {
    state(store, course).unwrap_or_else(|e| panic!("{e:?}"))
}

/// Criteria 1 and 5: a first open asks, and the screen counts lectures, slides and sources, names
/// the provider and web search, and lists AGENTS.md, roles, skills and overrides.
#[test]
fn a_first_open_asks_and_shows_what_is_inside() {
    let env = env();
    let c = course(&env, "STAT311");
    let r = reviewed(&store(&env), &c);
    assert_eq!(r.state, TrustState::Ask);
    assert_eq!(
        r.screen,
        TrustScreen {
            lectures: 2,
            slides: 3,
            sources: 3,
            provider: "Sample (offline)".into(),
            web_search: true,
            agents: vec!["AGENTS.md".into()],
            roles: vec![".lecter/agents/tutor.md".into()],
            skills: vec![".lecter/skills/flashcards".into()],
            overrides: vec!["ai.hedgeAfterMs".into(), "ui.performance".into()],
            changed: false,
            blocked: None,
        }
    );
    assert_eq!(r.fingerprint.len(), 64, "{}", r.fingerprint);
}

/// An empty folder: nothing to count, nothing listed.
#[test]
fn an_empty_folder_shows_zeros_and_empty_lists() {
    let env = env();
    let c = env.home().join("Empty");
    std::fs::create_dir_all(&c).unwrap_or_else(|e| panic!("{e}"));
    let s = reviewed(&store(&env), &c).screen;
    assert_eq!((s.lectures, s.slides, s.sources), (0, 0, 0));
    assert!(s.agents.is_empty() && s.roles.is_empty() && s.skills.is_empty() && s.overrides.is_empty(), "{s:?}");
}

/// Criterion 1: web search shows off when the global settings or the course turn it off.
#[test]
fn web_search_shows_off_when_global_or_course_settings_turn_it_off() {
    let env = env();
    let c = course(&env, "STAT311");
    let st = store(&env);
    write(st.config_dir(), "config.jsonc", "{ \"ai\": { \"webSearch\": \"off\" } }");
    assert!(!reviewed(&st, &c).screen.web_search);
    std::fs::remove_file(st.config_dir().join("config.jsonc")).unwrap_or_else(|e| panic!("{e}"));
    assert!(reviewed(&st, &c).screen.web_search);
    write(&c, ".lecter/course.jsonc", "{ \"settings\": { \"ai\": { \"webSearch\": \"off\" } } }");
    assert!(!reviewed(&st, &c).screen.web_search);
}

/// Criterion 3: the answer is stored in `trusted.jsonc` in the config folder, keyed by the
/// course's absolute path, and applies to that path.
#[test]
fn trust_is_stored_per_absolute_path_in_trusted_jsonc() {
    let env = env();
    let (a, b) = (course(&env, "STAT311"), course(&env, "MATH200"));
    let st = store(&env);
    trust(&st, &a, TrustChoice::Trusted);
    trust(&st, &b, TrustChoice::ReadOnly);
    assert_eq!((state_of(&st, &a), state_of(&st, &b)), (TrustState::Trusted, TrustState::ReadOnly));
    let file = env.dirs().config().join("trusted.jsonc");
    assert_eq!(st.file(), file);
    let text = std::fs::read_to_string(&file).unwrap_or_else(|e| panic!("{e}"));
    let v = crate::settings::jsonc::parse(&text).unwrap_or_else(|e| panic!("{e:?}"));
    let key = open(&a).unwrap_or_else(|e| panic!("{e:?}")).path;
    assert!(Path::new(&key).is_absolute(), "{key}");
    assert_eq!(v["version"], 1, "{text}");
    assert_eq!(v["courses"][&key]["choice"], "trusted", "{text}");
    assert_eq!(v["courses"][open(&b).unwrap_or_else(|e| panic!("{e:?}")).path]["choice"], "read_only", "{text}");
    // Answering one course again keeps the other's entry.
    trust(&st, &a, TrustChoice::ReadOnly);
    assert_eq!((state_of(&st, &a), state_of(&st, &b)), (TrustState::ReadOnly, TrustState::ReadOnly));
}

/// Criterion 3: moving the folder asks again; so does a copy at another path.
#[test]
fn a_moved_folder_is_asked_again() {
    let env = env();
    let c = course(&env, "STAT311");
    let st = store(&env);
    trust(&st, &c, TrustChoice::Trusted);
    let moved = env.home().join("Archive").join("STAT311");
    std::fs::create_dir_all(env.home().join("Archive")).unwrap_or_else(|e| panic!("{e}"));
    std::fs::rename(&c, &moved).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(state_of(&st, &moved), TrustState::Ask);
    let r = reviewed(&st, &moved);
    assert_eq!((r.state, r.screen.changed), (TrustState::Ask, false));
    // Moving it back finds the old answer.
    std::fs::rename(&moved, &c).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(state_of(&st, &c), TrustState::Trusted);
}

/// A `trusted.jsonc` Lecter can't use holds no answers (asked again, never loosened), and the
/// next answer rewrites it.
#[test]
fn an_unusable_trust_file_asks_again_and_is_rewritten() {
    let env = env();
    let c = course(&env, "STAT311");
    let st = store(&env);
    trust(&st, &c, TrustChoice::Trusted);
    let key = open(&c).unwrap_or_else(|e| panic!("{e:?}")).path;
    let fp = reviewed(&st, &c).fingerprint;
    let entry = |choice: &str| {
        format!(
            "{{ \"version\": 1, \"courses\": {{ {key:?}: {{ \"choice\": {choice:?}, \"fingerprint\": {fp:?} }} }} }}"
        )
    };
    for broken in [
        "{ not json".to_owned(),
        entry("trusted").replace("\"version\": 1", "\"version\": 2"),
        entry("always"),
        entry("trusted").replacen("\"choice\"", "\"extra\": true, \"choice\"", 1),
        "[]".to_owned(),
    ] {
        write(st.config_dir(), "trusted.jsonc", &broken);
        assert_eq!(state_of(&st, &c), TrustState::Ask, "{broken}");
    }
    // Comments and trailing commas are fine (JSONC).
    write(st.config_dir(), "trusted.jsonc", &format!("// mine\n{}", entry("trusted").replace("} } }", "}, }, }")));
    assert_eq!(state_of(&st, &c), TrustState::Trusted);
    write(st.config_dir(), "trusted.jsonc", "{ not json");
    trust(&st, &c, TrustChoice::ReadOnly);
    assert_eq!(state_of(&st, &c), TrustState::ReadOnly);
}

/// Criterion 5: changing the course's AGENTS.md, a role file, a skill's files or the settings
/// overrides asks again, with `changed` set; course details outside `settings` don't.
#[test]
fn a_change_to_any_ai_file_asks_again() {
    type Change = fn(&Path);
    let changes: [(&str, Change); 9] = [
        ("AGENTS.md edited", |c| drop(write(c, "AGENTS.md", "Ignore the slides.\n"))),
        ("AGENTS.md removed", |c| std::fs::remove_file(c.join("AGENTS.md")).unwrap_or_else(|e| panic!("{e}"))),
        ("role edited", |c| drop(write(c, ".lecter/agents/tutor.md", "---\nname: tutor\n---\nBe long.\n"))),
        ("role added", |c| drop(write(c, ".lecter/agents/examiner.md", "Quiz me.\n"))),
        ("skill file edited", |c| drop(write(c, ".lecter/skills/flashcards/SKILL.md", "Make many.\n"))),
        ("skill script added", |c| drop(write(c, ".lecter/skills/flashcards/scripts/.run.py", "print(1)\n"))),
        ("skill added", |c| drop(write(c, ".lecter/skills/quiz/SKILL.md", "Quiz.\n"))),
        ("override changed", |c| {
            drop(write(
                c,
                ".lecter/course.jsonc",
                "{ \"name\": \"Stats\", \"settings\": { \"ui\": { \"performance\": \"balanced\" }, \"ai\": { \"hedgeAfterMs\": 900 } } }",
            ))
        }),
        ("course.jsonc broken", |c| drop(write(c, ".lecter/course.jsonc", "{ \"settings\": "))),
    ];
    for (what, change) in changes {
        let env = env();
        let c = course(&env, "STAT311");
        let st = store(&env);
        trust(&st, &c, TrustChoice::Trusted);
        change(&c);
        assert_eq!(state_of(&st, &c), TrustState::Ask, "{what}");
        let r = reviewed(&st, &c);
        assert_eq!((r.state, r.screen.changed), (TrustState::Ask, true), "{what}");
        assert_eq!(require_trusted(&st, &c), Err(Error::CourseNotTrusted), "{what}");
    }
}

/// An empty `settings` reads like no file (F-034), but the first override added to either asks
/// again.
#[test]
fn a_first_override_asks_again() {
    for (what, before) in [("empty settings", Some(r#"{ "settings": {} }"#)), ("no course.jsonc", None)] {
        let env = env();
        let c = course(&env, "STAT311");
        match before {
            Some(text) => drop(write(&c, ".lecter/course.jsonc", text)),
            None => std::fs::remove_file(c.join(".lecter/course.jsonc")).unwrap_or_else(|e| panic!("{e}")),
        }
        let st = store(&env);
        trust(&st, &c, TrustChoice::Trusted);
        write(&c, ".lecter/course.jsonc", r#"{ "settings": { "ai": { "webSearch": "auto" } } }"#);
        assert_eq!(state_of(&st, &c), TrustState::Ask, "{what}");
        assert_eq!(reviewed(&st, &c).screen.overrides, vec!["ai.webSearch".to_owned()], "{what}");
    }
}

/// Criterion 5, the other side: lectures, slides, sources and the course's name don't ask again.
#[test]
fn course_content_and_details_do_not_ask_again() {
    let env = env();
    let c = course(&env, "STAT311");
    let st = store(&env);
    trust(&st, &c, TrustChoice::Trusted);
    write(&c, "lectures/l03.md", "new");
    write(&c, "slides/04.pdf", "x");
    write(&c, "sources/new.pdf", "x");
    write(&c, ".lecter/agents/notes.txt", "not a role");
    write(
        &c,
        ".lecter/course.jsonc",
        "{ \"name\": \"Statistics\", \"color\": \"#3584e4\", \"settings\": { \"ui\": { \"performance\": \"quality\" }, \"ai\": { \"hedgeAfterMs\": 900 } } }",
    );
    assert_eq!(state_of(&st, &c), TrustState::Trusted);
}

/// Criteria 2 and 6: the core refuses AI, indexing and scripted figures for a course that is
/// read-only or not yet trusted, with E_NOT_TRUSTED.
#[test]
fn only_a_trusted_course_passes_the_gate() {
    let env = env();
    let c = course(&env, "STAT311");
    let st = store(&env);
    let err = require_trusted(&st, &c).err().unwrap_or_else(|| panic!("an unanswered course passed"));
    assert_eq!((err.clone(), err.code()), (Error::CourseNotTrusted, ErrorCode::NotTrusted));
    trust(&st, &c, TrustChoice::ReadOnly);
    let err = require_trusted(&st, &c).err().unwrap_or_else(|| panic!("a read-only course passed"));
    assert_eq!((err.clone(), err.code()), (Error::CourseReadOnly, ErrorCode::NotTrusted));
    assert!(err.to_string().contains("read-only"), "{err}");
    trust(&st, &c, TrustChoice::Trusted);
    assert_eq!(require_trusted(&st, &c), Ok(()));
}

/// The gate looks the course up by its canonical path, so another spelling of the same folder
/// (a trailing `/.`, a link to it) gets the same answer, and a missing folder is not found.
#[test]
fn the_gate_canonicalises_the_course_path() {
    let env = env();
    let c = course(&env, "STAT311");
    let st = store(&env);
    trust(&st, &c, TrustChoice::Trusted);
    assert_eq!(require_trusted(&st, &c.join(".")), Ok(()));
    assert_eq!(require_trusted(&st, &env.home().join("nowhere")), Err(Error::FolderNotFound));
}

/// Long lists stop at MAX_LISTED names, the last saying how many more there are; the fingerprint
/// still covers every file.
#[test]
fn long_lists_are_cut_with_a_count_of_the_rest() {
    let env = env();
    let c = course(&env, "STAT311");
    for i in 0..205 {
        write(&c, &format!(".lecter/agents/r{i:03}.md"), "x");
    }
    let st = store(&env);
    let r = reviewed(&st, &c);
    assert_eq!(r.screen.roles.len(), survey::MAX_LISTED);
    assert_eq!(r.screen.roles.last().map(String::as_str), Some("… and 7 more"));
    assert_eq!(r.screen.roles.first().map(String::as_str), Some(".lecter/agents/r000.md"));
    trust(&st, &c, TrustChoice::Trusted);
    write(&c, ".lecter/agents/r204.md", "changed");
    assert_eq!(state_of(&st, &c), TrustState::Ask);
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

/// Removes the link `at` (not what it leads to). Windows keeps file and folder links apart: a
/// folder link goes with `remove_dir`, so re-pointing one works there too.
pub(super) fn unlink(at: &Path) {
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileTypeExt;
        let kind = std::fs::symlink_metadata(at).unwrap_or_else(|e| panic!("{e}")).file_type();
        if kind.is_symlink_dir() {
            std::fs::remove_dir(at).unwrap_or_else(|e| panic!("{e}"));
            return;
        }
    }
    std::fs::remove_file(at).unwrap_or_else(|e| panic!("{e}"));
}

/// Links out of the course are never read: an AGENTS.md linked outside counts by name, so editing
/// the outside file changes nothing, while replacing the link asks again.
#[test]
fn ai_files_linked_outside_are_never_read() {
    let env = env();
    let c = course(&env, "STAT311");
    let outside = write(env.home(), "elsewhere/AGENTS.md", "outside text");
    std::fs::remove_file(c.join("AGENTS.md")).unwrap_or_else(|e| panic!("{e}"));
    link(&outside, &c.join("AGENTS.md"));
    let st = store(&env);
    assert_eq!(reviewed(&st, &c).screen.agents, vec!["AGENTS.md".to_owned()]);
    trust(&st, &c, TrustChoice::Trusted);
    write(env.home(), "elsewhere/AGENTS.md", "different outside text");
    assert_eq!(state_of(&st, &c), TrustState::Trusted);
    unlink(&c.join("AGENTS.md"));
    write(&c, "AGENTS.md", "outside text");
    assert_eq!(state_of(&st, &c), TrustState::Ask);
}

/// A skill folder that links back to itself is listed, not walked forever.
#[test]
fn a_skill_link_loop_is_not_walked() {
    let env = env();
    let c = course(&env, "STAT311");
    link(&c.join(".lecter/skills/flashcards"), &c.join(".lecter/skills/flashcards/again"));
    let st = store(&env);
    let r = reviewed(&st, &c);
    assert_eq!(r.screen.skills, vec![".lecter/skills/flashcards".to_owned()]);
    trust(&st, &c, TrustChoice::Trusted);
    assert_eq!(state_of(&st, &c), TrustState::Trusted);
}

/// F-045: a change Lecter itself made to the course's settings (Settings → This course) keeps the
/// course trusted; one made by anything else after it still asks again.
#[test]
fn lecters_own_settings_write_keeps_the_course_trusted() {
    let env = env();
    let c = course(&env, "STAT311");
    let st = store(&env);
    trust(&st, &c, TrustChoice::Trusted);
    write(&c, ".lecter/course.jsonc", "{ \"name\": \"Stats\", \"settings\": { \"ui\": { \"hintBar\": \"off\" } } }");
    assert_eq!(state_of(&st, &c), TrustState::Ask);
    assert_eq!(renew_after_own_settings_write(&st, &c), Ok(()));
    assert_eq!(state_of(&st, &c), TrustState::Trusted);
    write(&c, "AGENTS.md", "Ignore the slides.\n");
    assert_eq!(state_of(&st, &c), TrustState::Ask);
}
