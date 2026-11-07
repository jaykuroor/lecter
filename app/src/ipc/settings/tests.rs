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

/// No course opened this session.
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

/// The contract (18-contracts.md#ipc, area `settings`).
#[test]
fn the_commands_take_the_key_value_and_course() {
    let contract = super::super::contract();
    let args = |name| crate::export::command_args(&contract, name);
    assert_eq!(args("settings_schema"), Some(vec![]));
    assert_eq!(args("settings_get"), Some(vec!["key".into(), "course".into()]));
    assert_eq!(args("settings_set"), Some(vec!["key".into(), "value".into(), "course".into(), "scope".into()]));
    assert_eq!(args("settings_source"), Some(vec!["course".into()]));
}

#[test]
fn the_schema_is_the_generated_one() {
    let schema: serde_json::Value = serde_json::from_str(&run(settings_schema()).unwrap()).unwrap();
    assert_eq!(schema["$defs"]["Ui"]["properties"]["performance"]["default"], "balanced");
}

/// 12-settings-theme-onboarding.md#performance-preset: Balanced is the default.
#[test]
fn an_unset_key_is_its_default() {
    let env = TestEnv::new().unwrap();
    let (files, courses) = (SettingsFiles::new(&env.dirs()), no_courses(&env));
    let got = run(get(&files, &courses, "ui.performance".into(), None)).unwrap();
    assert_eq!(got, setting("ui.performance", "\"balanced\"", SettingSource::Default));
}

/// F-040 criterion 4: `:set ui.performance=quality` applies at once; the file keeps it.
#[test]
fn a_write_goes_to_the_global_file_and_is_in_force_at_once() {
    let env = TestEnv::new().unwrap();
    let (files, courses) = (SettingsFiles::new(&env.dirs()), no_courses(&env));
    let set_to =
        run(set(&files, &courses, "ui.performance".into(), "\"quality\"".into(), None, SettingScope::Global)).unwrap();
    assert_eq!(set_to, setting("ui.performance", "\"quality\"", SettingSource::Global));
    let got = run(get(&files, &courses, "ui.performance".into(), None)).unwrap();
    assert_eq!(got, setting("ui.performance", "\"quality\"", SettingSource::Global));
    let text = std::fs::read_to_string(env.dirs().config().join("config.jsonc")).unwrap();
    assert!(text.contains("\"quality\""), "{text}");
    let flag =
        run(set(&files, &courses, "index.contextLines".into(), "true".into(), None, SettingScope::Global)).unwrap();
    assert_eq!(flag, setting("index.contextLines", "true", SettingSource::Global));
}

/// F-040 criteria 2 and 4: a value outside the schema is refused with the allowed values.
#[test]
fn a_value_the_schema_refuses_is_rejected_with_the_reason() {
    let env = TestEnv::new().unwrap();
    let (files, courses) = (SettingsFiles::new(&env.dirs()), no_courses(&env));
    let e =
        run(set(&files, &courses, "ui.performance".into(), "\"fast\"".into(), None, SettingScope::Global)).unwrap_err();
    assert_eq!(
        (e.code, e.message.as_str()),
        (ErrorCode::InvalidArgument, "ui.performance must be one of performance, balanced, quality")
    );
    assert!(!env.dirs().config().join("config.jsonc").exists(), "a refused value was written");
    let e = run(set(&files, &courses, "ui.speed".into(), "1".into(), None, SettingScope::Global)).unwrap_err();
    assert_eq!((e.code, e.message.as_str()), (ErrorCode::InvalidArgument, "ui.speed is not a setting"));
    let e =
        run(set(&files, &courses, "ui.performance".into(), "quality".into(), None, SettingScope::Global)).unwrap_err();
    assert_eq!((e.code, e.message.as_str()), (ErrorCode::InvalidArgument, "The value for ui.performance is not JSON."));
    let e = run(get(&files, &courses, "ui.speed".into(), None)).unwrap_err();
    assert_eq!((e.code, e.message.as_str()), (ErrorCode::NotFound, "ui.speed is not a setting"));
}

/// SEC-32: a key over 256 bytes is refused before anything is read.
#[test]
fn an_oversize_key_is_an_invalid_argument() {
    let env = TestEnv::new().unwrap();
    let (files, courses) = (SettingsFiles::new(&env.dirs()), no_courses(&env));
    let long = "a".repeat(MAX_KEY_BYTES + 1);
    assert_eq!(run(get(&files, &courses, long.clone(), None)).unwrap_err().code, ErrorCode::InvalidArgument);
    assert_eq!(
        run(set(&files, &courses, long, "1".into(), None, SettingScope::Global)).unwrap_err().code,
        ErrorCode::InvalidArgument
    );
    let at_limit = "a".repeat(MAX_KEY_BYTES);
    assert_eq!(run(get(&files, &courses, at_limit, None)).unwrap_err().code, ErrorCode::NotFound);
}

/// `:set key?` names the level: a trusted course's own value wins over the global one.
#[test]
fn a_trusted_course_value_wins_and_says_so() {
    let env = TestEnv::new().unwrap();
    let (path, courses) = course(&env, Some(TrustChoice::Trusted));
    let files = SettingsFiles::new(&env.dirs());
    run(set(&files, &courses, "ui.performance".into(), "\"quality\"".into(), None, SettingScope::Global)).unwrap();
    let got = run(get(&files, &courses, "ui.performance".into(), Some(path.clone()))).unwrap();
    assert_eq!(got, setting("ui.performance", "\"performance\"", SettingSource::Course));
    // A write is global; the course's value stays in force there, and the answer says so.
    let after =
        run(set(&files, &courses, "ui.performance".into(), "\"balanced\"".into(), Some(path), SettingScope::Global))
            .unwrap();
    assert_eq!(after, setting("ui.performance", "\"performance\"", SettingSource::Course));
}

/// SEC-27: an untrusted or read-only course's settings don't apply.
#[test]
fn an_untrusted_course_has_no_say() {
    for choice in [None, Some(TrustChoice::ReadOnly)] {
        let env = TestEnv::new().unwrap();
        let (path, courses) = course(&env, choice);
        let files = SettingsFiles::new(&env.dirs());
        let got = run(get(&files, &courses, "ui.performance".into(), Some(path))).unwrap();
        assert_eq!(got, setting("ui.performance", "\"balanced\"", SettingSource::Default), "{choice:?}");
    }
}

/// SEC-32: a course must be one this session opened.
#[test]
fn a_course_not_opened_this_session_is_refused() {
    let env = TestEnv::new().unwrap();
    let (files, courses) = (SettingsFiles::new(&env.dirs()), no_courses(&env));
    let e = run(get(&files, &courses, "ui.performance".into(), Some("/elsewhere".into()))).unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidArgument);
    let e = run(set(
        &files,
        &courses,
        "ui.performance".into(),
        "\"quality\"".into(),
        Some("/elsewhere".into()),
        SettingScope::Global,
    ))
    .unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidArgument);
    assert!(!env.dirs().config().join("config.jsonc").exists(), "written for a course not opened");
}

#[test]
fn a_file_that_cannot_be_written_is_an_io_error() {
    let env = TestEnv::new().unwrap();
    let (files, courses) = (SettingsFiles::new(&env.dirs()), no_courses(&env));
    std::fs::create_dir_all(env.dirs().config().join("config.jsonc")).unwrap();
    let e = run(set(&files, &courses, "ui.performance".into(), "\"quality\"".into(), None, SettingScope::Global))
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::Io, "{e:?}");
}
