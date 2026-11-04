//! Settings files changed on disk apply within 1 s without a restart (criterion 4 of F-030).
#![allow(clippy::disallowed_methods, reason = "tests write files on test threads")]

use std::collections::BTreeSet;
use std::ffi::OsString;
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant};

use notify::{Event, EventKind};
use serde_json::json;

use super::tests_files::{setup, write};
use super::watch::{MAX_DELAY, QUIET, settle, touches};
use super::*;

/// Starts a watcher whose callback forwards the notices to the returned channel.
fn watch(store: &Arc<SettingsStore>) -> (SettingsWatcher, Receiver<Vec<Notice>>) {
    let (tx, rx) = mpsc::channel();
    let watcher = SettingsWatcher::start(Arc::clone(store), move |notices| {
        let _ = tx.send(notices);
    })
    .expect("watch");
    (watcher, rx)
}

/// Criterion 4: the global file rewritten in place applies within 1 s.
#[test]
fn settings_change_on_disk_applies_within_one_second() {
    let (env, global, root) = setup(r#"{ "ui": { "performance": "balanced" } }"#, Some(r#"{ "settings": {} }"#));
    let store = Arc::new(SettingsStore::open(&env.dirs(), Some(&root)));
    let (_watcher, rx) = watch(&store);
    let start = Instant::now();
    write(&global, r#"{ "ui": { "performance": "performance" } }"#);
    rx.recv_timeout(Duration::from_secs(1)).expect("change seen within 1 s");
    assert!(start.elapsed() < Duration::from_secs(1), "{:?}", start.elapsed());
    assert_eq!(store.get("ui.performance").map(|r| (r.value, r.source)), Some((json!("performance"), Source::Global)));
}

/// Criterion 4: the course file saved the way editors do (temp file renamed over it) applies
/// within 1 s.
#[test]
fn settings_course_file_replaced_by_rename_applies_within_one_second() {
    let (env, _, root) = setup("{}", Some(r#"{ "settings": {} }"#));
    let store = Arc::new(SettingsStore::open(&env.dirs(), Some(&root)));
    let (_watcher, rx) = watch(&store);
    let lecter = root.join(".lecter");
    let start = Instant::now();
    write(&lecter.join("course.jsonc.swp"), r#"{ "settings": { "ui": { "performance": "quality" } } }"#);
    std::fs::rename(lecter.join("course.jsonc.swp"), lecter.join(COURSE_FILE)).expect("rename");
    rx.recv_timeout(Duration::from_secs(1)).expect("course change seen within 1 s");
    assert!(start.elapsed() < Duration::from_secs(1), "{:?}", start.elapsed());
    assert_eq!(store.get("ui.performance").map(|r| (r.value, r.source)), Some((json!("quality"), Source::Course)));
}

/// With no config folder yet, the watcher makes it, so a `config.jsonc` created later applies.
#[test]
fn settings_global_file_created_after_start_applies() {
    let env = crate::testenv::TestEnv::new().expect("home");
    assert!(!env.dirs().config().exists());
    let store = Arc::new(SettingsStore::open(&env.dirs(), None));
    let (_watcher, rx) = watch(&store);
    assert!(env.dirs().config().is_dir());
    write(&env.dirs().config().join(GLOBAL_FILE), r#"{ "ui": { "performance": "quality" } }"#);
    rx.recv_timeout(Duration::from_secs(1)).expect("seen within 1 s");
    assert_eq!(store.get("ui.performance").map(|r| r.source), Some(Source::Global));
}

/// A change that only brings news (the file broke; values stay) still reaches the app.
#[test]
fn settings_watcher_passes_on_notices_when_no_value_changed() {
    let (env, global, _) = setup(r#"{ "ui": { "performance": "quality" } }"#, None);
    let store = Arc::new(SettingsStore::open(&env.dirs(), None));
    let (_watcher, rx) = watch(&store);
    write(&global, "{ \"ui\": ");
    let notices = rx.recv_timeout(Duration::from_secs(1)).expect("seen");
    assert!(matches!(&notices[..], [Notice::Unreadable { .. }]), "{notices:?}");
    assert_eq!(store.get("ui.performance").map(|r| r.value), Some(json!("quality")));
}

#[test]
fn settings_watcher_reports_new_notices_and_ignores_other_files() {
    let (env, global, _) = setup("{}", None);
    let store = Arc::new(SettingsStore::open(&env.dirs(), None));
    let (_watcher, rx) = watch(&store);
    write(&env.dirs().config().join("keymaps.jsonc"), "{}");
    write(&global, r#"{ "mystery": 1 }"#);
    let notices = rx.recv_timeout(Duration::from_secs(1)).expect("seen");
    assert_eq!(notices, vec![Notice::UnknownKeys { file: global, keys: vec!["mystery".into()] }]);
}

#[test]
fn settings_watch_events_count_only_for_the_settings_files() {
    let names: BTreeSet<OsString> = [OsString::from("config.jsonc"), OsString::from("course.jsonc")].into();
    let event = |path: &str| Ok(Event::new(EventKind::Any).add_path(path.into()));
    assert!(touches(&event("/c/lecter/config.jsonc"), &names));
    assert!(touches(&event("/c/course/.lecter/course.jsonc"), &names));
    assert!(!touches(&event("/c/lecter/keymaps.jsonc"), &names));
    assert!(!touches(&event("/c/lecter/.config.jsonc.tmp"), &names));
    assert!(!touches(&event("/"), &names));
    // A rename names both ends; either end counts.
    let rename =
        Ok(Event::new(EventKind::Any).add_path("/c/lecter/x.tmp".into()).add_path("/c/lecter/config.jsonc".into()));
    assert!(touches(&rename, &names));
    // A lost event queue may hide a change.
    assert!(touches(&Err(notify::Error::generic("overflow")), &names));
}

/// Events that keep coming delay a reload by at most `MAX_DELAY` (plus one quiet wait).
#[test]
fn settings_watch_settle_caps_the_delay_under_a_stream_of_events() {
    let (tx, rx) = mpsc::channel::<()>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let feeder = std::thread::spawn(move || {
        // One event every 10 ms (the wait on `stop_rx` paces it) until told to stop, for at
        // most 3 s.
        let end = Instant::now() + Duration::from_secs(3);
        while let Err(mpsc::RecvTimeoutError::Timeout) = stop_rx.recv_timeout(Duration::from_millis(10)) {
            if Instant::now() > end || tx.send(()).is_err() {
                break;
            }
        }
    });
    let start = Instant::now();
    assert!(settle(&rx));
    let waited = start.elapsed();
    drop(stop_tx);
    feeder.join().expect("feeder");
    assert!(waited >= MAX_DELAY, "{waited:?}");
    // Well under the feeder's 3 s, with room for a loaded machine.
    assert!(waited < Duration::from_secs(1), "{waited:?}");
}

/// A single event settles after one quiet period; a gone watcher ends the wait.
#[test]
fn settings_watch_settle_waits_one_quiet_period_and_stops_with_the_watcher() {
    let (tx, rx) = mpsc::channel::<()>();
    let start = Instant::now();
    assert!(settle(&rx));
    assert!(start.elapsed() >= QUIET && start.elapsed() < MAX_DELAY, "{:?}", start.elapsed());
    drop(tx);
    assert!(!settle(&rx));
}
