//! Settings files changed on disk apply within 1 s without a restart (criterion 4 of F-030).
#![allow(clippy::disallowed_methods, reason = "tests write files on test threads")]

use std::cell::Cell;
use std::collections::BTreeSet;
use std::ffi::OsString;
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use notify::event::{AccessKind, AccessMode, CreateKind, ModifyKind, RemoveKind};
use notify::{Event, EventKind};
use serde_json::json;

use super::tests_files::{setup, write};
use super::watch::{MAX_DELAY, QUIET, settle, settle_with, touches};
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
    // Opening or reading a file changes nothing (the reload's own reads would loop forever).
    let access = |kind| Ok(Event::new(EventKind::Access(kind)).add_path("/c/lecter/config.jsonc".into()));
    assert!(!touches(&access(AccessKind::Open(AccessMode::Any)), &names));
    assert!(!touches(&access(AccessKind::Close(AccessMode::Read)), &names));
    assert!(!touches(&access(AccessKind::Read), &names));
    assert!(touches(&access(AccessKind::Close(AccessMode::Write)), &names));
    for kind in
        [EventKind::Create(CreateKind::File), EventKind::Modify(ModifyKind::Any), EventKind::Remove(RemoveKind::File)]
    {
        assert!(touches(&Ok(Event::new(kind).add_path("/c/lecter/config.jsonc".into())), &names), "{kind:?}");
    }
    // A lost event queue may hide a change.
    assert!(touches(&Err(notify::Error::generic("overflow")), &names));
}

/// The gap between events in [`settle_on_a_fake_clock`].
const STEP: Duration = Duration::from_millis(10);

/// Runs `settle_with` on a fake clock against a source that delivers one event every [`STEP`]
/// while `events_for` lasts, then none (each wait times out after its full length). Returns
/// what settle returned and how long it waited in fake time. Nothing here depends on how the
/// OS schedules threads, so a slow machine can't make it flaky.
fn settle_on_a_fake_clock(events_for: Duration) -> (bool, Duration) {
    let t0 = Instant::now();
    let now = Cell::new(t0);
    let settled = settle_with(
        |wait| {
            assert_eq!(wait, QUIET, "settle waits one quiet period for the next event");
            let elapsed = now.get().duration_since(t0);
            if elapsed + STEP <= events_for {
                now.set(now.get() + STEP);
                Ok(())
            } else {
                now.set(now.get() + wait);
                Err(RecvTimeoutError::Timeout)
            }
        },
        || now.get(),
    );
    (settled, now.get().duration_since(t0))
}

/// Events that keep coming delay a reload by at most `MAX_DELAY` (plus one quiet wait).
#[test]
fn settings_watch_settle_caps_the_delay_under_a_stream_of_events() {
    // A stream far longer than the cap.
    let (settled, waited) = settle_on_a_fake_clock(Duration::from_secs(3));
    assert!(settled);
    assert!(waited >= MAX_DELAY, "{waited:?}");
    // Returns at the first event once the cap has passed, not one event later.
    assert!(waited < MAX_DELAY + STEP, "{waited:?}");
}

/// A burst shorter than the cap settles one quiet period after its last event.
#[test]
fn settings_watch_settle_waits_a_quiet_period_after_the_last_event() {
    let burst = Duration::from_millis(100);
    let (settled, waited) = settle_on_a_fake_clock(burst);
    assert!(settled);
    assert_eq!(waited, burst + QUIET);
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
