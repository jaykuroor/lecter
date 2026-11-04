//! SEC-25: a course can't set global-only keys or loosen global values (criterion 5 of F-030),
//! against the hostile course fixture `tests/fixtures/courses/hostile/`.
#![allow(clippy::disallowed_methods, reason = "tests write files on test threads")]

use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use super::*;
use crate::testenv::TestEnv;

fn hostile_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/courses/hostile")
}

/// Global settings that the hostile course tries to loosen.
const GLOBAL: &str = r#"{
  "ai": { "webSearch": "off", "search": { "blockDomains": ["Tracker.example"] } },
  "privacy": { "shareFeedback": false },
  "feedback": { "endpoint": null }
}"#;

fn open_hostile() -> (TestEnv, SettingsStore) {
    let env = TestEnv::new().expect("home");
    let config = env.dirs().config().join(GLOBAL_FILE);
    std::fs::create_dir_all(config.parent().expect("parent")).expect("mkdir");
    std::fs::write(&config, GLOBAL).expect("write");
    let store = SettingsStore::open(&env.dirs(), Some(&hostile_root()));
    (env, store)
}

/// Every key the hostile course sets that must be ignored, sorted.
const IGNORED: [&str; 18] = [
    "Feedback.Endpoint",
    "LOG",
    "PRIVACY",
    "ai.budget.monthly",
    "ai.budget.monthlyTokens",
    "ai.search.allowFetch",
    "ai.search.blockDomains",
    "ai.search.searxngURL",
    "ai.search.serviceUrl",
    "ai.webSearch",
    "feedback.endpoint",
    "limits",
    "log",
    "misc.nested.base_url",
    "privacy",
    "privacy.shareFeedbackText",
    "providers.openai.baseUrl",
    "providers.openai.host",
];

/// Criterion 5: none of the global-only or loosening values apply; each resolves from the global
/// settings or the default.
#[test]
fn settings_sec25_hostile_course_cannot_loosen_global_settings() {
    let (_env, store) = open_hostile();
    let from = |key: &str| store.get(key).map(|r| (r.value, r.source));
    assert_eq!(from("privacy.shareFeedback"), Some((json!(false), Source::Global)));
    assert_eq!(from("privacy.shareFeedbackText"), Some((json!(false), Source::Default)));
    assert_eq!(from("feedback.endpoint"), Some((Value::Null, Source::Global)));
    assert_eq!(from("log.content"), Some((json!(false), Source::Default)));
    assert_eq!(from("limits.providerResponseBytes"), Some((json!(16 << 20), Source::Default)));
    assert_eq!(from("ai.budget.monthly"), Some((json!(5.0), Source::Default)));
    assert_eq!(from("ai.budget.monthlyTokens"), Some((json!(2_000_000), Source::Default)));
    assert_eq!(from("ai.webSearch"), Some((json!("off"), Source::Global)));
    assert_eq!(from("ai.search.allowFetch"), Some((json!(false), Source::Default)));
    assert_eq!(from("ai.search.blockDomains"), Some((json!(["Tracker.example"]), Source::Global)));
    let settings = store.settings();
    assert!(!settings.privacy.share_feedback && !settings.privacy.share_feedback_text && !settings.log.content);
    assert_eq!(settings.feedback.endpoint, None);
}

/// Criterion 5: the course's allowed overrides still apply (it is not ignored wholesale).
#[test]
fn settings_sec25_hostile_course_keeps_its_allowed_overrides() {
    let (_env, store) = open_hostile();
    let from = |key: &str| store.get(key).map(|r| (r.value, r.source));
    assert_eq!(from("ui.performance"), Some((json!("quality"), Source::Course)));
    assert_eq!(from("ai.budget.daily"), Some((json!(0.5), Source::Course)));
    assert_eq!(from("ai.budget.perLecture"), Some((json!(0.25), Source::Course)));
    let settings = store.settings();
    assert_eq!(settings.ui.performance, schema::Performance::Quality);
    assert_eq!((settings.ai.budget.daily, settings.ai.budget.per_lecture), (0.5, Some(0.25)));
    assert_eq!(settings.ai.web_search, schema::WebSearch::Off);
}

/// Criterion 5: one notice lists every ignored key; reloading doesn't repeat it.
#[test]
fn settings_sec25_hostile_course_gives_one_notice_listing_every_ignored_key() {
    let (_env, store) = open_hostile();
    let course = hostile_root().join(".lecter").join(COURSE_FILE);
    let notices = store.take_notices();
    let ignored: Vec<&Notice> = notices.iter().filter(|n| matches!(n, Notice::GlobalOnlyIgnored { .. })).collect();
    assert_eq!(
        ignored,
        vec![&Notice::GlobalOnlyIgnored {
            file: course.clone(),
            keys: IGNORED.iter().map(|k| (*k).to_owned()).collect()
        }]
    );
    // The unknown keys are reported as unknown, not ignored.
    assert!(notices.contains(&Notice::UnknownKeys {
        file: course,
        keys: vec!["experimentalThing".into(), "pr\u{0456}vacy".into()]
    }));
    store.reload();
    assert_eq!(store.take_notices(), vec![]);
}

/// The global file may set every key the course can't.
#[test]
fn settings_sec25_global_file_may_set_global_only_keys() {
    let global = Layer::from_value(
        Source::Global,
        &json!({ "privacy": { "shareFeedback": true }, "feedback": { "endpoint": "https://f.example" }, "log": { "content": true } }),
    );
    assert!(global.ignored.is_empty() && global.unknown.is_empty(), "{global:?}");
    let stack = SettingsStack::new(global, None, None, None);
    assert_eq!(stack.get("privacy.shareFeedback").map(|r| (r.value, r.source)), Some((json!(true), Source::Global)));
    assert_eq!(stack.settings().feedback.endpoint.as_deref(), Some("https://f.example"));
}

/// Role files obey the same rules as `course.jsonc`.
#[test]
fn settings_sec25_role_layer_cannot_set_global_only_keys_or_enable_web_search() {
    let global = Layer::from_value(Source::Global, &json!({ "ai": { "webSearch": "off" } }));
    let role = Layer::from_value(
        Source::Role,
        &json!({ "privacy": { "shareFeedback": true }, "ai": { "webSearch": "service" } }),
    );
    assert_eq!(role.ignored, ["privacy"]);
    let stack = SettingsStack::new(global, None, Some(role), None);
    assert_eq!(stack.loosening(), [(Source::Role, "ai.webSearch".to_owned())]);
    assert_eq!(stack.get("ai.webSearch").map(|r| r.source), Some(Source::Global));
    assert_eq!(stack.get("privacy.shareFeedback").map(|r| r.source), Some(Source::Default));
}

/// Tighten-only keys: equal or tighter values apply, looser ones don't.
#[test]
fn settings_sec25_budgets_and_search_may_only_tighten() {
    let global = || {
        Layer::from_value(
            Source::Global,
            &json!({ "ai": { "budget": { "daily": 2, "perLecture": 0.5 }, "search": { "allowFetch": true, "allowDomains": ["a.example", "b.example"], "blockDomains": ["x.example"] } } }),
        )
    };
    let tight = Layer::from_value(
        Source::Course,
        &json!({ "ai": { "budget": { "daily": 2, "perLecture": 0.1, "monthly": 4.99 }, "webSearch": "off", "search": { "allowFetch": false, "allowDomains": ["A.example"], "blockDomains": ["x.example", "y.example"] } } }),
    );
    let stack = SettingsStack::new(global(), Some(tight), None, None);
    assert_eq!(stack.loosening(), []);
    for key in [
        "ai.budget.daily",
        "ai.budget.perLecture",
        "ai.budget.monthly",
        "ai.webSearch",
        "ai.search.allowFetch",
        "ai.search.allowDomains",
        "ai.search.blockDomains",
    ] {
        assert_eq!(stack.get(key).map(|r| r.source), Some(Source::Course), "{key}");
    }
    let loose = Layer::from_value(
        Source::Course,
        &json!({ "ai": { "budget": { "daily": 2.01, "perLecture": null }, "search": { "allowDomains": [], "blockDomains": ["y.example"] } } }),
    );
    let stack = SettingsStack::new(global(), Some(loose), None, None);
    let mut dropped: Vec<&str> = stack.loosening().iter().map(|(_, k)| k.as_str()).collect();
    dropped.sort_unstable();
    assert_eq!(
        dropped,
        ["ai.budget.daily", "ai.budget.perLecture", "ai.search.allowDomains", "ai.search.blockDomains"]
    );
    let wider = Layer::from_value(
        Source::Course,
        &json!({ "ai": { "search": { "allowDomains": ["a.example", "c.example"] } } }),
    );
    let stack = SettingsStack::new(global(), Some(wider), None, None);
    assert_eq!(stack.loosening(), [(Source::Course, "ai.search.allowDomains".to_owned())]);
    // Turning on what the global settings already allow is no loosening.
    let same = Layer::from_value(
        Source::Course,
        &json!({ "ai": { "webSearch": "service", "search": { "allowFetch": true } } }),
    );
    let stack = SettingsStack::new(global(), Some(same), None, None);
    assert_eq!(stack.loosening(), []);
    assert_eq!(stack.get("ai.webSearch").map(|r| (r.value, r.source)), Some((json!("service"), Source::Course)));
    assert_eq!(stack.get("ai.search.allowFetch").map(|r| (r.value, r.source)), Some((json!(true), Source::Course)));
}

/// Global-only matching: groups and destination words in any spelling, and nothing else.
#[test]
fn settings_sec25_global_only_key_names() {
    use super::global_only::is_global_only;
    for key in [
        "privacy",
        "privacy.shareFeedback",
        "Log.content",
        "limits.ipc.stringBytes",
        "feedback.endpoint",
        "FEEDBACK.ENDPOINT",
        "providers.openai.baseUrl",
        "providers.openai.BASEURL",
        "providers.x.base_url",
        "providers.x.apiHost",
        "providers.x.hostname",
        "ai.search.serviceURL",
        "ai.search.searxngUrl",
        "ai.search.urls",
        "proxy.endpoints",
        "ai.search.uri",
        "providers.x.api_host",
        "providers.x.APIHost",
        "providers.x.proxy2Host",
    ] {
        assert!(is_global_only(key), "{key} should be global-only");
    }
    for key in [
        "ui.performance",
        "ai.budget.daily",
        "ai.search.service",
        "ui.curlyQuotes",
        "feedback",
        "ai.hostility",
        "ai.ghosts",
        "logo.size",
        "privacyNote",
    ] {
        assert!(!is_global_only(key), "{key} should be allowed in a course");
    }
}

/// `:set` in a course refuses what the file would ignore.
#[test]
fn settings_sec25_course_writes_refuse_global_only_and_looser_values() {
    let env = TestEnv::new().expect("home");
    let root = env.home().join("course");
    std::fs::create_dir_all(root.join(".lecter")).expect("mkdir");
    let store = SettingsStore::open(&env.dirs(), Some(&root));
    assert_eq!(
        store.set(Scope::Course, "privacy.shareFeedback", json!(true)),
        Err(SetError::GlobalOnly("privacy.shareFeedback".into()))
    );
    assert_eq!(
        store.set(Scope::Course, "feedback.endpoint", json!("https://x.example")),
        Err(SetError::GlobalOnly("feedback.endpoint".into()))
    );
    assert_eq!(
        store.set(Scope::Course, "ai.budget.monthly", json!(6)),
        Err(SetError::Loosens("ai.budget.monthly".into()))
    );
    assert!(!root.join(".lecter").join(COURSE_FILE).exists());
    store.set(Scope::Course, "ai.budget.monthly", json!(4)).expect("tighter is fine");
    assert_eq!(store.get("ai.budget.monthly").map(|r| (r.value, r.source)), Some((json!(4), Source::Course)));
    store.set(Scope::Global, "privacy.shareFeedback", json!(true)).expect("global may");
    assert_eq!(store.get("privacy.shareFeedback").map(|r| r.source), Some(Source::Global));
}

/// Raising the global cap later lets a course value that was too high apply, and lowering it
/// drops it again: the check is against the global value in force.
#[test]
fn settings_sec25_loosening_is_judged_against_the_current_global_value() {
    let env = TestEnv::new().expect("home");
    let root = env.home().join("course");
    std::fs::create_dir_all(root.join(".lecter")).expect("mkdir");
    std::fs::write(
        root.join(".lecter").join(COURSE_FILE),
        r#"{ "settings": { "ai": { "budget": { "monthly": 8 } } } }"#,
    )
    .expect("write");
    let store = SettingsStore::open(&env.dirs(), Some(&root));
    assert_eq!(store.get("ai.budget.monthly").map(|r| r.source), Some(Source::Default));
    store.set(Scope::Global, "ai.budget.monthly", json!(10)).expect("set");
    assert_eq!(store.get("ai.budget.monthly").map(|r| (r.value, r.source)), Some((json!(8), Source::Course)));
}
