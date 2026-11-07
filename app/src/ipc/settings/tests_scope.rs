//! F-045: the Settings window's writes (global or course), `settings_source`, and writes that
//! overlap.
#![allow(clippy::disallowed_methods, reason = "tests build fixture files on plain test threads")]

use lecter_core::course::trust::{TrustChoice, TrustStore};
use lecter_core::testenv::TestEnv;

use super::*;

fn run<T>(f: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(f)
}

fn setting(key: &str, value: &str, source: SettingSource) -> Setting {
    Setting { key: key.into(), value: value.into(), source }
}

fn no_courses(env: &TestEnv) -> OpenedCourses {
    OpenedCourses::new(TrustStore::new(&env.dirs()))
}

/// A course whose course.jsonc sets `ui.performance` to `performance`, opened this session with
/// its trust question answered `choice`.
fn course(env: &TestEnv, choice: Option<TrustChoice>) -> (String, OpenedCourses) {
    let dir = env.home().join("STAT311");
    std::fs::create_dir_all(dir.join(".lecter")).unwrap();
    std::fs::create_dir_all(dir.join("lectures")).unwrap();
    std::fs::write(
        dir.join(".lecter/course.jsonc"),
        "{\"version\": 1, \"settings\": {\"ui\": {\"performance\": \"performance\"}}}",
    )
    .unwrap();
    let listing = lecter_core::course::open(&std::fs::canonicalize(&dir).unwrap()).unwrap();
    let courses = super::super::course::opened_for_test(env, &listing, choice);
    (listing.path, courses)
}

/// The course's `.lecter/course.jsonc` text.
fn course_file(path: &str) -> String {
    std::fs::read_to_string(std::path::Path::new(path).join(".lecter/course.jsonc")).unwrap()
}

fn global_exists(env: &TestEnv) -> bool {
    env.dirs().config().join("config.jsonc").exists()
}

/// Criterion 2: "This course" writes the course's file, and the value is in force there at once;
/// the global file is untouched.
#[test]
fn a_course_write_goes_to_the_course_file() {
    let env = TestEnv::new().unwrap();
    let (path, courses) = course(&env, Some(TrustChoice::Trusted));
    let files = SettingsFiles::new(&env.dirs());
    let got =
        run(set(&files, &courses, "ui.hintBar".into(), "\"compact\"".into(), Some(path.clone()), SettingScope::Course))
            .unwrap();
    assert_eq!(got, setting("ui.hintBar", "\"compact\"", SettingSource::Course));
    let text = course_file(&path);
    let value: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(value["settings"]["ui"]["hintBar"], "compact", "{text}");
    assert_eq!(value["settings"]["ui"]["performance"], "performance", "{text}");
    assert!(!global_exists(&env), "a course write reached the global file");
    // The user's own change doesn't ask the trust question again.
    assert_eq!(trust::require_trusted(courses.trust(), std::path::Path::new(&path)), Ok(()));
    // A global write of the same key leaves the course's value in force, and says so.
    let after =
        run(set(&files, &courses, "ui.hintBar".into(), "\"off\"".into(), Some(path), SettingScope::Global)).unwrap();
    assert_eq!(after, setting("ui.hintBar", "\"compact\"", SettingSource::Course));
    assert!(global_exists(&env));
}

/// SEC-25: a course write of a global-only key is refused, and neither file changes.
#[test]
fn a_course_write_of_a_global_only_key_is_refused() {
    let env = TestEnv::new().unwrap();
    let (path, courses) = course(&env, Some(TrustChoice::Trusted));
    let files = SettingsFiles::new(&env.dirs());
    let before = course_file(&path);
    for (key, value) in [("privacy.shareFeedback", "true"), ("log.content", "true"), ("feedback.endpoint", "\"x\"")] {
        let e =
            run(set(&files, &courses, key.into(), value.into(), Some(path.clone()), SettingScope::Course)).unwrap_err();
        assert_eq!(
            (e.code, e.message),
            (ErrorCode::InvalidArgument, format!("{key} can only be set in the global settings"))
        );
    }
    assert_eq!(course_file(&path), before);
    assert!(!global_exists(&env));
}

/// A course write needs a course, and one that is trusted (SEC-27: a read-only course's files are
/// never written).
#[test]
fn a_course_write_needs_a_trusted_course() {
    let env = TestEnv::new().unwrap();
    let (files, courses) = (SettingsFiles::new(&env.dirs()), no_courses(&env));
    let e = run(set(&files, &courses, "ui.hintBar".into(), "\"off\"".into(), None, SettingScope::Course)).unwrap_err();
    assert_eq!((e.code, e.message.as_str()), (ErrorCode::InvalidArgument, "Open a course to change its settings."));
    assert!(!global_exists(&env));
    for choice in [None, Some(TrustChoice::ReadOnly)] {
        let env = TestEnv::new().unwrap();
        let (path, courses) = course(&env, choice);
        let files = SettingsFiles::new(&env.dirs());
        let before = course_file(&path);
        let e =
            run(set(&files, &courses, "ui.hintBar".into(), "\"off\"".into(), Some(path.clone()), SettingScope::Course))
                .unwrap_err();
        assert_eq!(e.code, ErrorCode::NotTrusted, "{choice:?}");
        assert_eq!(course_file(&path), before, "{choice:?}");
        assert!(!global_exists(&env), "{choice:?}");
    }
}

/// `settings_source`: every setting in force with its level, and whether a course may set it.
#[test]
fn the_source_lists_every_setting_in_force() {
    let env = TestEnv::new().unwrap();
    let (path, courses) = course(&env, Some(TrustChoice::Trusted));
    let files = SettingsFiles::new(&env.dirs());
    run(set(&files, &courses, "ui.hintBar".into(), "\"off\"".into(), None, SettingScope::Global)).unwrap();
    let all = run(source(&files, &courses, Some(path))).unwrap();
    let keys: Vec<&str> = all.iter().map(|s| s.key.as_str()).collect();
    let known: Vec<&str> = lecter_core::settings::known_keys().collect();
    assert_eq!(keys, known);
    let find = |k: &str| all.iter().find(|s| s.key == k).cloned().unwrap();
    assert_eq!(
        find("ui.performance"),
        SettingState {
            key: "ui.performance".into(),
            value: "\"performance\"".into(),
            source: SettingSource::Course,
            global_only: false,
        }
    );
    assert_eq!((find("ui.hintBar").value, find("ui.hintBar").source), ("\"off\"".into(), SettingSource::Global));
    assert_eq!((find("ui.keystrokes").value, find("ui.keystrokes").source), ("true".into(), SettingSource::Default));
    assert!(find("privacy.shareFeedback").global_only);
    assert!(find("limits.providerLineBytes").global_only);
    assert!(find("feedback.endpoint").global_only);
    assert!(!find("ai.webSearch").global_only);
    // Without the course, its value doesn't count.
    let global = run(source(&files, &courses, None)).unwrap();
    let perf = global.iter().find(|s| s.key == "ui.performance").cloned().unwrap();
    assert_eq!((perf.value.as_str(), perf.source), ("\"balanced\"", SettingSource::Default));
}

/// SEC-32: `settings_source` takes only a course this session opened.
#[test]
fn the_source_of_a_course_not_opened_is_refused() {
    let env = TestEnv::new().unwrap();
    let (files, courses) = (SettingsFiles::new(&env.dirs()), no_courses(&env));
    let e = run(source(&files, &courses, Some("/elsewhere".into()))).unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidArgument);
}

/// Writes that overlap don't lose one another: each reads the file and writes it under one lock.
#[test]
fn overlapping_writes_all_land() {
    let env = TestEnv::new().unwrap();
    let files = SettingsFiles::new(&env.dirs());
    let courses = std::sync::Arc::new(no_courses(&env));
    let writes = [
        ("ui.hintBar", "\"off\""),
        ("ui.keystrokes", "false"),
        ("ui.performance", "\"quality\""),
        ("index.contextLines", "true"),
        ("ai.hedgeAfterMs", "1234"),
        ("ai.search.maxPerAnswer", "7"),
        ("figures.mode.page", "\"off\""),
        ("parsing.vision", "\"off\""),
    ];
    for _round in 0..4 {
        let threads: Vec<_> = writes
            .iter()
            .map(|&(k, v)| {
                let (files, courses) = (files.clone(), courses.clone());
                std::thread::spawn(move || {
                    run(set(&files, &courses, k.into(), v.into(), None, SettingScope::Global)).unwrap()
                })
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        for (k, v) in writes {
            let got = run(get(&files, &courses, k.into(), None)).unwrap();
            assert_eq!((got.value.as_str(), got.source), (v, SettingSource::Global), "{k}");
        }
        std::fs::remove_file(env.dirs().config().join("config.jsonc")).unwrap();
    }
}

/// SEC-32: a value over 64 KiB is refused before it is parsed; one at the limit is taken.
#[test]
fn an_oversize_value_is_an_invalid_argument() {
    let env = TestEnv::new().unwrap();
    let (files, courses) = (SettingsFiles::new(&env.dirs()), no_courses(&env));
    let at_limit = format!("\"{}\"", "a".repeat(MAX_VALUE_BYTES - 2));
    assert_eq!(at_limit.len(), 64 * 1024);
    let got =
        run(set(&files, &courses, "ai.defaultFast".into(), at_limit.clone(), None, SettingScope::Global)).unwrap();
    assert_eq!((got.value.len(), got.source), (at_limit.len(), SettingSource::Global));
    std::fs::remove_file(env.dirs().config().join("config.jsonc")).unwrap();
    let over = format!("\"{}\"", "a".repeat(MAX_VALUE_BYTES - 1));
    let e = run(set(&files, &courses, "ai.defaultFast".into(), over, None, SettingScope::Global)).unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidArgument);
    assert!(!global_exists(&env), "an oversize value was written");
}

/// A read-only course's own settings are never written, and its answer stays read-only.
#[test]
fn a_course_write_by_a_read_only_answer_meanwhile_is_refused() {
    let env = TestEnv::new().unwrap();
    let (path, courses) = course(&env, Some(TrustChoice::ReadOnly));
    let files = SettingsFiles::new(&env.dirs());
    let e = run(set(&files, &courses, "ui.hintBar".into(), "\"off\"".into(), Some(path.clone()), SettingScope::Course))
        .unwrap_err();
    assert_eq!(
        (e.code, e.message.as_str()),
        (ErrorCode::NotTrusted, "Trust this course to give it settings of its own.")
    );
    assert_eq!(
        trust::require_trusted(courses.trust(), std::path::Path::new(&path)),
        Err(lecter_core::Error::CourseReadOnly)
    );
}
