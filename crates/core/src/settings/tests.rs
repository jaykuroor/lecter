//! Schema, precedence and validation (criteria 1, 2 and 6 of F-030).

use proptest::prelude::*;
use serde_json::{Value, json};

use super::keys::nest;
use super::*;

const SCHEMA_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/src/settings/settings.schema.json");

/// Criterion 1: the committed schema is what the Rust types generate. Run with
/// `LECTER_WRITE_SCHEMA=1` to regenerate it after changing the types.
#[test]
#[allow(clippy::disallowed_methods, reason = "a test")]
fn settings_schema_committed_file_matches_the_rust_types() {
    let generated = schema_json();
    if std::env::var_os("LECTER_WRITE_SCHEMA").is_some() {
        std::fs::write(SCHEMA_PATH, &generated).expect("write schema");
    }
    let committed = std::fs::read_to_string(SCHEMA_PATH).expect("settings.schema.json is committed");
    assert!(
        committed == generated,
        "settings.schema.json is stale: run `LECTER_WRITE_SCHEMA=1 cargo test -p lecter-core settings_schema`"
    );
}

#[test]
fn settings_schema_describes_ui_performance_with_its_three_values_and_balanced_default() {
    let schema: Value = serde_json::from_str(&schema_json()).expect("schema is JSON");
    assert_eq!(schema["title"], "Lecter settings");
    assert_eq!(schema["properties"]["ui"]["default"]["performance"], "balanced");
    assert_eq!(
        allowed_values("ui.performance"),
        Some(vec!["performance".to_owned(), "balanced".to_owned(), "quality".to_owned()])
    );
}

#[test]
fn settings_known_keys_are_the_dotted_leaves_of_the_types() {
    let keys: Vec<&str> = known_keys().collect();
    for key in
        ["ui.performance", "ai.budget.monthly", "ai.search.allowFetch", "privacy.shareFeedback", "feedback.endpoint"]
    {
        assert!(keys.contains(&key), "{key} missing from {keys:?}");
    }
    // Groups are not keys.
    assert!(!keys.contains(&"ui") && !keys.contains(&"ai.budget"), "{keys:?}");
}

/// Criterion 6: the default is balanced, from the built-in default.
#[test]
fn settings_ui_performance_defaults_to_balanced() {
    let stack = SettingsStack::new(Layer::default(), None, None, None);
    assert_eq!(stack.get("ui.performance"), Some(Resolved { value: json!("balanced"), source: Source::Default }));
    assert_eq!(stack.settings().ui.performance, schema::Performance::Balanced);
}

/// Criterion 6: each of the three values is accepted and applies.
#[test]
fn settings_ui_performance_accepts_each_preset() {
    for (text, preset) in [
        ("performance", schema::Performance::Performance),
        ("balanced", schema::Performance::Balanced),
        ("quality", schema::Performance::Quality),
    ] {
        let layer = Layer::from_value(Source::Global, &json!({ "ui": { "performance": text } }));
        assert!(layer.invalid.is_empty(), "{text}: {:?}", layer.invalid);
        let stack = SettingsStack::new(layer, None, None, None);
        assert_eq!(stack.get("ui.performance").map(|r| (r.value, r.source)), Some((json!(text), Source::Global)));
        assert_eq!(stack.settings().ui.performance, preset);
    }
}

/// Criterion 6: anything else is rejected with the allowed list, and the default stays.
#[test]
fn settings_ui_performance_rejects_other_values_with_the_allowed_list() {
    for bad in [json!("fast"), json!("Balanced"), json!(""), json!(1), json!(null), json!(["quality"])] {
        let layer = Layer::from_value(Source::Global, &json!({ "ui": { "performance": bad } }));
        assert_eq!(
            layer.invalid,
            vec![(
                "ui.performance".to_owned(),
                "ui.performance must be one of performance, balanced, quality".to_owned()
            )],
            "{bad}"
        );
        let stack = SettingsStack::new(layer, None, None, None);
        assert_eq!(stack.get("ui.performance").map(|r| r.source), Some(Source::Default), "{bad}");
    }
}

#[test]
fn settings_a_wrong_type_is_invalid_and_the_lower_level_applies() {
    let global = Layer::from_value(Source::Global, &json!({ "ai": { "hedgeAfterMs": 900 } }));
    let course = Layer::from_value(Source::Course, &json!({ "ai": { "hedgeAfterMs": "soon" }, "ui": 3 }));
    assert_eq!(course.invalid.len(), 2, "{:?}", course.invalid);
    assert!(
        course.invalid.iter().any(|(k, r)| k == "ai.hedgeAfterMs" && r.starts_with("ai.hedgeAfterMs: invalid type"))
    );
    assert!(course.invalid.contains(&("ui".to_owned(), "ui must be an object".to_owned())));
    let stack = SettingsStack::new(global, Some(course), None, None);
    assert_eq!(stack.get("ai.hedgeAfterMs"), Some(Resolved { value: json!(900), source: Source::Global }));
}

#[test]
fn settings_unknown_keys_are_reported_at_their_first_unknown_name() {
    let layer = Layer::from_value(
        Source::Global,
        &json!({ "ui": { "performanc": "quality", "theme2": { "a": 1 } }, "editor": { "x": { "y": 1 } }, "a.b": 1, "": 2 }),
    );
    let mut unknown = layer.unknown.clone();
    unknown.sort();
    assert_eq!(unknown, ["", "a.b", "editor", "ui.performanc", "ui.theme2"]);
    assert_eq!(layer.keys().count(), 0);
}

#[test]
fn settings_a_dotted_key_name_is_never_read_as_a_path() {
    let layer = Layer::from_value(Source::Global, &json!({ "ui.performance": "quality" }));
    assert_eq!(layer.unknown, ["ui.performance"]);
    assert_eq!(layer.get("ui.performance"), None);
}

#[test]
fn settings_get_of_an_unknown_key_is_none() {
    let stack = SettingsStack::new(Layer::default(), None, None, None);
    assert_eq!(stack.get("ui.nope"), None);
    assert_eq!(stack.get("ui"), None);
    assert_eq!(allowed_values("ui.nope"), None);
    assert_eq!(allowed_values("ai.hedgeAfterMs"), None);
}

/// The levels from most to least specific, as `12-settings-theme-onboarding.md#settings` lists them.
const ORDER: [Source; 4] = [Source::Prompt, Source::Role, Source::Course, Source::Global];

/// Keys no tighten-only rule touches, with a strategy of valid values for each.
fn arb_key_value() -> impl Strategy<Value = (&'static str, Value)> {
    prop_oneof![
        prop::sample::select(vec!["performance", "balanced", "quality"]).prop_map(|v| ("ui.performance", json!(v))),
        (0u32..100_000).prop_map(|v| ("ai.hedgeAfterMs", json!(v))),
        prop::sample::select(vec!["provider", "local", "auto", "off"]).prop_map(|v| ("parsing.vision", json!(v))),
        any::<bool>().prop_map(|v| ("index.contextLines", json!(v))),
        (0u32..10).prop_map(|v| ("ai.search.maxPerAnswer", json!(v))),
    ]
}

proptest! {
    /// Criterion 2: the most specific level that sets a key wins and is reported as the source;
    /// a key no level sets reports its default.
    #[test]
    fn settings_precedence_prompt_role_course_global_default(
        sets in prop::collection::vec(prop::option::of(arb_key_value()), 4),
        probe in prop::sample::select(vec!["ui.performance", "ai.hedgeAfterMs", "parsing.vision", "index.contextLines", "ai.search.maxPerAnswer"]),
    ) {
        let layers: Vec<Layer> = ORDER
            .iter()
            .zip(&sets)
            .map(|(source, set)| match set {
                Some((key, value)) => Layer::from_value(*source, &nest(key, value.clone())),
                None => Layer::default(),
            })
            .collect();
        let [prompt, role, course, global]: [Layer; 4] = layers.try_into().expect("four layers");
        let stack = SettingsStack::new(global, Some(course), Some(role), Some(prompt));

        let expected = ORDER
            .iter()
            .zip(&sets)
            .find_map(|(source, set)| set.as_ref().filter(|(k, _)| *k == probe).map(|(_, v)| (v.clone(), *source)))
            .unwrap_or_else(|| (serde_json::to_value(Settings::default()).expect("defaults").pointer(&format!("/{}", probe.replace('.', "/"))).cloned().expect("default exists"), Source::Default));
        let got = stack.get(probe).expect("known key");
        prop_assert_eq!((got.value, got.source), expected);
    }
}

#[test]
fn settings_precedence_one_key_set_at_every_level_takes_the_prompt_value() {
    let at = |s: Source, v: &str| Layer::from_value(s, &json!({ "ui": { "performance": v } }));
    let stack = SettingsStack::new(
        at(Source::Global, "performance"),
        Some(at(Source::Course, "balanced")),
        Some(at(Source::Role, "performance")),
        Some(at(Source::Prompt, "quality")),
    );
    assert_eq!(stack.get("ui.performance"), Some(Resolved { value: json!("quality"), source: Source::Prompt }));
    let stack = SettingsStack::new(at(Source::Global, "performance"), Some(at(Source::Course, "quality")), None, None);
    assert_eq!(stack.get("ui.performance"), Some(Resolved { value: json!("quality"), source: Source::Course }));
    assert_eq!(stack.settings().ui.performance, schema::Performance::Quality);
}

/// F-045: `ui.hintBar` is full, compact or off, full by default (D-206); `ui.keystrokes` is on by
/// default (09-ui.md: the keystroke overlay is on for new users, D-212).
#[test]
fn settings_ui_hint_bar_and_keystrokes_have_their_spec_defaults() {
    let stack = SettingsStack::new(Layer::default(), None, None, None);
    assert_eq!(stack.get("ui.hintBar"), Some(Resolved { value: json!("full"), source: Source::Default }));
    assert_eq!(stack.get("ui.keystrokes"), Some(Resolved { value: json!(true), source: Source::Default }));
    assert_eq!(allowed_values("ui.hintBar"), Some(vec!["full".to_owned(), "compact".to_owned(), "off".to_owned()]));
    let layer = Layer::from_value(Source::Global, &json!({ "ui": { "hintBar": "compact", "keystrokes": false } }));
    assert!(layer.invalid.is_empty(), "{:?}", layer.invalid);
    let stack = SettingsStack::new(layer, None, None, None);
    assert_eq!(stack.settings().ui.hint_bar, schema::HintBar::Compact);
    assert!(!stack.settings().ui.keystrokes);
    // The Settings window greys these out for a course (SEC-25).
    assert!(is_global_only("privacy.shareFeedback") && is_global_only("feedback.endpoint"));
    assert!(!is_global_only("ui.hintBar") && !is_global_only("ai.webSearch"));
    let bad = Layer::from_value(Source::Global, &json!({ "ui": { "hintBar": "tiny", "keystrokes": "yes" } }));
    assert_eq!(bad.invalid.len(), 2, "{:?}", bad.invalid);
}
