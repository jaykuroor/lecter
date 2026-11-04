//! Settings files on disk: unknown keys kept and reported once (criterion 3), changes applied
//! without a restart (criterion 4), and the file edge cases.
#![allow(clippy::disallowed_methods, reason = "tests write files on test threads")]

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde_json::json;

use super::*;
use crate::testenv::TestEnv;

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
    std::fs::write(path, text).expect("write");
}

fn read(path: &Path) -> String {
    std::fs::read_to_string(path).expect("read")
}

/// A test home with a global config and a course folder holding `.lecter/`.
fn setup(global: &str, course: Option<&str>) -> (TestEnv, PathBuf, PathBuf) {
    let env = TestEnv::new().expect("test home");
    let global_path = env.dirs().config().join(GLOBAL_FILE);
    write(&global_path, global);
    let root = env.home().join("course");
    std::fs::create_dir_all(root.join(".lecter")).expect("mkdir");
    if let Some(text) = course {
        write(&root.join(".lecter").join(COURSE_FILE), text);
    }
    (env, global_path, root)
}

const GLOBAL_WITH_UNKNOWN: &str = r#"{
  // my settings
  "ui": {
    "performance": "performance", // fast laptop? no
    "zoomLevel": 3
  },
  "pluginX": { "enabled": true, "list": [1, 2, 3] },
}
"#;

/// Criterion 3: unknown keys survive a write, along with comments and formatting.
#[test]
fn settings_unknown_keys_are_preserved_on_write() {
    let (env, global, _) = setup(GLOBAL_WITH_UNKNOWN, None);
    let store = SettingsStore::open(&env.dirs(), None);
    store.set(Scope::Global, "ui.performance", json!("quality")).expect("set");
    store.set(Scope::Global, "ai.budget.daily", json!(2.5)).expect("set");
    let text = read(&global);
    let expected = r#"{
  // my settings
  "ui": {
    "performance": "quality", // fast laptop? no
    "zoomLevel": 3
  },
  "pluginX": { "enabled": true, "list": [1, 2, 3] },
  "ai": {
    "budget": {
      "daily": 2.5
    }
  },
}
"#;
    assert_eq!(text, expected);
    assert_eq!(store.get("ui.performance").map(|r| (r.value, r.source)), Some((json!("quality"), Source::Global)));
    assert_eq!(store.get("ai.budget.daily").map(|r| r.value), Some(json!(2.5)));
}

#[test]
fn settings_course_write_goes_under_settings_and_keeps_the_course_details() {
    let course = "{\n  \"version\": 1,\n  \"name\": \"Stats\", // the card\n  \"futureField\": [true]\n}\n";
    let (env, _, root) = setup("{}", Some(course));
    let store = SettingsStore::open(&env.dirs(), Some(&root));
    store.set(Scope::Course, "ui.performance", json!("quality")).expect("set");
    let text = read(&root.join(".lecter").join(COURSE_FILE));
    assert!(
        text.starts_with("{\n  \"version\": 1,\n  \"name\": \"Stats\", // the card\n  \"futureField\": [true],\n"),
        "{text}"
    );
    let value: serde_json::Value = jsonc_parser::parse_to_serde_value(&text, &Default::default()).expect("parses");
    assert_eq!(value["settings"]["ui"]["performance"], "quality");
    assert_eq!(value["futureField"], json!([true]));
    assert_eq!(store.get("ui.performance").map(|r| r.source), Some(Source::Course));
}

#[test]
fn settings_write_creates_a_missing_global_file() {
    let env = TestEnv::new().expect("home");
    let store = SettingsStore::open(&env.dirs(), None);
    store.set(Scope::Global, "ui.performance", json!("performance")).expect("set");
    let text = read(&env.dirs().config().join(GLOBAL_FILE));
    let value: serde_json::Value = serde_json::from_str(&text).expect("JSON");
    assert_eq!(value, json!({ "ui": { "performance": "performance" } }));
}

#[test]
fn settings_write_refuses_bad_keys_and_values_and_leaves_the_file_alone() {
    let (env, global, root) = setup(GLOBAL_WITH_UNKNOWN, Some("{}"));
    let store = SettingsStore::open(&env.dirs(), Some(&root));
    assert_eq!(store.set(Scope::Global, "ui.zoom", json!(1)), Err(SetError::UnknownKey("ui.zoom".into())));
    assert_eq!(
        store.set(Scope::Global, "ui.performance", json!("fast")),
        Err(SetError::Invalid("ui.performance must be one of performance, balanced, quality".into()))
    );
    assert_eq!(read(&global), GLOBAL_WITH_UNKNOWN);
    let none = SettingsStore::open(&env.dirs(), None);
    assert_eq!(none.set(Scope::Course, "ui.performance", json!("quality")), Err(SetError::NoCourse));
}

/// Criterion 3: each unknown key is reported once, not on every reload, and a new one is reported
/// when it appears.
#[test]
fn settings_unknown_keys_are_reported_once() {
    let (env, global, _) = setup(GLOBAL_WITH_UNKNOWN, None);
    let store = SettingsStore::open(&env.dirs(), None);
    assert_eq!(
        store.take_notices(),
        vec![Notice::UnknownKeys { file: global.clone(), keys: vec!["pluginX".into(), "ui.zoomLevel".into()] }]
    );
    // A write and a reload of the same keys report nothing again.
    store.set(Scope::Global, "ui.performance", json!("quality")).expect("set");
    write(&global, &format!("{}\n// touched\n", read(&global)));
    assert!(store.reload());
    assert_eq!(store.take_notices(), vec![]);
    // A new unknown key is reported, alone.
    write(&global, r#"{ "ui": { "zoomLevel": 3, "x": 1 }, "pluginX": {} }"#);
    assert!(store.reload());
    assert_eq!(store.take_notices(), vec![Notice::UnknownKeys { file: global, keys: vec!["ui.x".into()] }]);
}

#[test]
fn settings_a_broken_file_keeps_its_last_good_values_and_is_reported_once() {
    let (env, global, _) = setup(r#"{ "ui": { "performance": "quality" } }"#, None);
    let store = SettingsStore::open(&env.dirs(), None);
    assert_eq!(store.take_notices(), vec![]);
    write(&global, "{ \"ui\": { \"performance\": \"perf");
    assert!(!store.reload());
    assert!(!store.reload());
    let notices = store.take_notices();
    assert_eq!(notices.len(), 1, "{notices:?}");
    assert!(
        matches!(&notices[0], Notice::Unreadable { reason, .. } if reason == "is not valid JSONC (line 1, column 26)"),
        "{notices:?}"
    );
    assert_eq!(store.get("ui.performance").map(|r| r.value), Some(json!("quality")));
    // Put back as it was, then broken again: that is news too.
    write(&global, r#"{ "ui": { "performance": "quality" } }"#);
    assert!(!store.reload());
    write(&global, "{");
    store.reload();
    assert_eq!(store.take_notices().len(), 1);
    // Fixed: applies, and a later breakage is reported again.
    write(&global, r#"{ "ui": { "performance": "performance" } }"#);
    assert!(store.reload());
    assert_eq!(store.get("ui.performance").map(|r| r.value), Some(json!("performance")));
    write(&global, "[]");
    store.reload();
    assert!(
        matches!(&store.take_notices()[..], [Notice::Unreadable { reason, .. }] if reason == "must hold an object at the top level")
    );
}

#[test]
fn settings_json5_extras_and_oversized_files_are_refused() {
    for text in [
        "{ ui: {} }",
        "{ 'ui': {} }",
        r#"{ "ai": { "hedgeAfterMs": 0x10 } }"#,
        r#"{ "ai": { "budget": { "daily": Infinity } } }"#,
    ] {
        assert!(super::jsonc::parse(text).is_err(), "{text}");
    }
    assert_eq!(super::jsonc::parse("  \n").expect("empty is fine"), json!({}));
    let (env, global, _) = setup("", None);
    let big = format!("{{ \"pad\": \"{}\" }}", "x".repeat(super::jsonc::MAX_FILE_BYTES as usize));
    write(&global, &big);
    let store = SettingsStore::open(&env.dirs(), None);
    assert_eq!(
        store.take_notices(),
        vec![Notice::Unreadable {
            file: global,
            reason: format!("is larger than {} bytes", super::jsonc::MAX_FILE_BYTES)
        }]
    );
}

#[test]
fn settings_deeply_nested_files_do_not_overflow_the_stack() {
    let (env, global, _) = setup("", None);
    let deep = format!("{{ \"ui\": {}1{} }}", "{\"a\": ".repeat(400), "}".repeat(400));
    write(&global, &deep);
    let store = SettingsStore::open(&env.dirs(), None);
    assert_eq!(store.get("ui.performance").map(|r| r.source), Some(Source::Default));
    let deeper = format!("{}1{}", "[".repeat(5000), "]".repeat(5000));
    write(&global, &deeper);
    store.reload();
    assert!(store.take_notices().iter().any(|n| matches!(n, Notice::Unreadable { .. })));
}

/// Criterion 4: an edit on disk applies within 1 s, with no restart and no call from the app.
#[test]
fn settings_change_on_disk_applies_within_one_second() {
    let (env, global, root) = setup(r#"{ "ui": { "performance": "balanced" } }"#, Some(r#"{ "settings": {} }"#));
    let store = Arc::new(SettingsStore::open(&env.dirs(), Some(&root)));
    let (tx, rx) = mpsc::channel();
    let _watcher = SettingsWatcher::start(Arc::clone(&store), move |notices| {
        let _ = tx.send(notices);
    })
    .expect("watch");

    // An in-place rewrite of the global file.
    let start = Instant::now();
    write(&global, r#"{ "ui": { "performance": "performance" } }"#);
    rx.recv_timeout(Duration::from_secs(1)).expect("change seen within 1 s");
    assert!(start.elapsed() < Duration::from_secs(1), "{:?}", start.elapsed());
    assert_eq!(store.get("ui.performance").map(|r| (r.value, r.source)), Some((json!("performance"), Source::Global)));

    // An editor-style save of the course file: write a temp file, rename it over.
    let course = root.join(".lecter").join(COURSE_FILE);
    let tmp = root.join(".lecter").join("course.jsonc.swp");
    let start = Instant::now();
    write(&tmp, r#"{ "settings": { "ui": { "performance": "quality" } } }"#);
    std::fs::rename(&tmp, &course).expect("rename");
    let deadline = start + Duration::from_secs(1);
    while store.get("ui.performance").map(|r| r.source) != Some(Source::Course) {
        let left = deadline.saturating_duration_since(Instant::now());
        rx.recv_timeout(left).expect("course change seen within 1 s");
    }
    assert_eq!(store.get("ui.performance").map(|r| r.value), Some(json!("quality")));
    assert!(start.elapsed() < Duration::from_secs(1), "{:?}", start.elapsed());
}

#[test]
fn settings_watcher_reports_new_notices_and_ignores_other_files() {
    let (env, global, _) = setup("{}", None);
    let store = Arc::new(SettingsStore::open(&env.dirs(), None));
    let (tx, rx) = mpsc::channel();
    let _watcher = SettingsWatcher::start(Arc::clone(&store), move |n| {
        let _ = tx.send(n);
    })
    .expect("watch");
    write(&env.dirs().config().join("keymaps.jsonc"), "{}");
    write(&global, r#"{ "mystery": 1 }"#);
    let notices = rx.recv_timeout(Duration::from_secs(1)).expect("seen");
    assert_eq!(notices, vec![Notice::UnknownKeys { file: global, keys: vec!["mystery".into()] }]);
}

#[cfg(unix)]
#[test]
fn settings_course_file_linked_out_of_the_course_is_not_read() {
    let (env, _, root) = setup("{}", None);
    let outside = env.home().join("elsewhere.jsonc");
    write(&outside, r#"{ "settings": { "ui": { "performance": "quality" } } }"#);
    let course = root.join(".lecter").join(COURSE_FILE);
    std::os::unix::fs::symlink(&outside, &course).expect("link");
    let store = SettingsStore::open(&env.dirs(), Some(&root));
    assert_eq!(store.get("ui.performance").map(|r| r.source), Some(Source::Default));
    assert_eq!(
        store.take_notices(),
        vec![Notice::Unreadable { file: course.clone(), reason: "points outside the course folder".into() }]
    );
    assert!(matches!(
        store.set(Scope::Course, "ui.performance", json!("quality")),
        Err(SetError::File { error: FileError::OutsideCourse, .. })
    ));
    assert_eq!(read(&outside), r#"{ "settings": { "ui": { "performance": "quality" } } }"#);
}

#[cfg(unix)]
#[test]
fn settings_course_file_as_a_dangling_link_is_refused() {
    let (env, _, root) = setup("{}", None);
    let course = root.join(".lecter").join(COURSE_FILE);
    std::os::unix::fs::symlink(env.home().join("nowhere.jsonc"), &course).expect("link");
    let store = SettingsStore::open(&env.dirs(), Some(&root));
    assert_eq!(
        store.take_notices(),
        vec![Notice::Unreadable { file: course, reason: "points outside the course folder".into() }]
    );
    assert!(!env.home().join("nowhere.jsonc").exists());
}

#[cfg(unix)]
#[test]
fn settings_a_file_the_os_refuses_is_reported_not_treated_as_missing() {
    use std::os::unix::fs::PermissionsExt;
    let (env, global, _) = setup(r#"{ "ui": { "performance": "quality" } }"#, None);
    std::fs::set_permissions(&global, std::fs::Permissions::from_mode(0o000)).expect("chmod");
    if std::fs::File::open(&global).is_ok() {
        // Running as root: permissions don't apply, so there is nothing to observe.
        return;
    }
    let store = SettingsStore::open(&env.dirs(), None);
    assert_eq!(
        store.take_notices(),
        vec![Notice::Unreadable { file: global, reason: "could not be read (PermissionDenied)".into() }]
    );
}

#[test]
fn settings_a_file_of_exactly_the_size_limit_is_read() {
    let (env, global, _) = setup("", None);
    let head = r#"{ "ui": { "performance": "quality" }, "pad": ""#;
    let tail = "\" }";
    let max = super::jsonc::MAX_FILE_BYTES as usize;
    let text = format!("{head}{}{tail}", "x".repeat(max - head.len() - tail.len()));
    assert_eq!(text.len(), max);
    write(&global, &text);
    let store = SettingsStore::open(&env.dirs(), None);
    assert_eq!(store.get("ui.performance").map(|r| (r.value, r.source)), Some((json!("quality"), Source::Global)));
}

#[cfg(unix)]
#[test]
fn settings_course_lecter_folder_linked_out_of_the_course_is_not_read() {
    let (env, _, _) = setup("{}", None);
    let root = env.home().join("course2");
    let outside = env.home().join("outside-lecter");
    write(&outside.join(COURSE_FILE), r#"{ "settings": { "ui": { "performance": "quality" } } }"#);
    std::fs::create_dir_all(&root).expect("mkdir");
    std::os::unix::fs::symlink(&outside, root.join(".lecter")).expect("link");
    let store = SettingsStore::open(&env.dirs(), Some(&root));
    assert_eq!(store.get("ui.performance").map(|r| r.source), Some(Source::Default));
}
