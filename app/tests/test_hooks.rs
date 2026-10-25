//! F-016 criteria 1 and 4 (01-architecture.md#debug-only-test-hooks, SEC-34): the embedded
//! WebDriver server is a dependency only with the `test-hooks` feature and registered only there,
//! and the `LECTER_TEST_*` dialog hooks are compiled only into debug or `test-hooks` builds.
//! scripts/check_release_binary.sh proves the same on built binaries (tests/e2e/release-check.sh).

#![allow(clippy::disallowed_methods, reason = "tests read repo files on plain test threads, not on an async runtime")]

#[allow(dead_code, reason = "each test binary uses only some of the shared helpers")]
mod support;

use std::path::{Path, PathBuf};

use support::{app_dir, read};

const PLUGIN: &str = "tauri-plugin-wdio-webdriver";
const PLUGIN_RS: &str = "tauri_plugin_wdio_webdriver";
const FEATURE_GATE: &str = "#[cfg(feature = \"test-hooks\")]";
const HOOK_GATE: &str = "#[cfg(any(debug_assertions, feature = \"test-hooks\"))]";

/// The `[section]` of Cargo.toml up to the next header.
fn section<'a>(manifest: &'a str, header: &str) -> &'a str {
    manifest.split(&format!("\n[{header}]\n")).nth(1).and_then(|s| s.split("\n[").next()).unwrap_or("")
}

#[test]
fn webdriver_plugin_is_an_optional_dependency_enabled_only_by_test_hooks() {
    let manifest = read("Cargo.toml");
    let deps = section(&manifest, "dependencies");
    let line = deps
        .lines()
        .find(|l| l.starts_with(&format!("{PLUGIN} ")))
        .unwrap_or_else(|| panic!("{PLUGIN} is not a dependency"));
    assert!(line.replace(' ', "").contains("optional=true"), "{PLUGIN} must be optional: {line}");

    let features = section(&manifest, "features");
    let enabling: Vec<&str> = features.lines().filter(|l| l.contains(PLUGIN)).collect();
    assert_eq!(enabling.len(), 1, "exactly one feature may enable {PLUGIN}: {enabling:?}");
    assert!(enabling[0].replace(' ', "").starts_with("test-hooks=["), "only test-hooks may enable it: {enabling:?}");
    assert!(
        !features.lines().any(|l| l.replace(' ', "").starts_with("default=")),
        "lecter-app has default features; test-hooks must never be on by default"
    );
    // Any other table naming the plugin (target, dev, build) would put it in other builds too.
    assert_eq!(manifest.matches(PLUGIN).count(), 2, "{PLUGIN} appears outside [dependencies] and test-hooks");
}

#[test]
fn webdriver_plugin_is_registered_only_under_test_hooks() {
    let sources = rust_sources();
    let mut uses = 0;
    for (path, text) in &sources {
        let lines: Vec<&str> = text.lines().collect();
        for (i, l) in lines.iter().enumerate() {
            if l.contains(PLUGIN_RS) && !l.trim_start().starts_with("//") {
                uses += 1;
                let prev = i.checked_sub(1).map(|p| lines[p].trim()).unwrap_or("");
                assert_eq!(prev, FEATURE_GATE, "{}:{} uses the plugin outside {FEATURE_GATE}", path.display(), i + 1);
            }
        }
    }
    assert_eq!(uses, 1, "the plugin is registered once, in main.rs");
}

#[test]
fn dialog_hooks_are_compiled_only_into_debug_or_test_hooks_builds() {
    let main = read("src/main.rs");
    let decl = main.find("mod test_hooks;").unwrap_or_else(|| panic!("main.rs declares no test_hooks module"));
    let before: Vec<&str> = main[..decl].lines().collect();
    assert_eq!(before.last().map(|l| l.trim()), Some(HOOK_GATE), "mod test_hooks is not gated by {HOOK_GATE}");

    for (path, text) in rust_sources() {
        let rel = path.to_string_lossy().replace('\\', "/");
        if rel.ends_with("src/test_hooks.rs") {
            for var in ["LECTER_TEST_PICK", "LECTER_TEST_TRUST"] {
                assert!(text.contains(&format!("\"{var}\"")), "test_hooks.rs does not read {var}");
            }
            continue;
        }
        assert!(!text.contains("LECTER_TEST_"), "{rel} names a test hook; only src/test_hooks.rs may");
        let lines: Vec<&str> = text.lines().collect();
        for (i, l) in lines.iter().enumerate() {
            if l.contains("test_hooks::") {
                let prev = i.checked_sub(1).map(|p| lines[p].trim()).unwrap_or("");
                assert_eq!(prev, HOOK_GATE, "{rel}:{} calls a test hook outside {HOOK_GATE}", i + 1);
            }
        }
    }
}

#[test]
fn every_dialog_goes_through_the_hookable_wrapper() {
    for (path, text) in rust_sources() {
        let rel = path.to_string_lossy().replace('\\', "/");
        if rel.ends_with("src/dialog.rs") {
            assert!(text.contains("crate::test_hooks::picked_path()"), "dialog.rs does not consult LECTER_TEST_PICK");
            continue;
        }
        for needle in ["DialogExt", ".dialog()"] {
            assert!(!text.contains(needle), "{rel} opens a dialog directly; use crate::dialog so tests can answer it");
        }
    }
}

/// Every `.rs` file under `app/src`, with its text.
fn rust_sources() -> Vec<(PathBuf, String)> {
    fn walk(dir: &Path, out: &mut Vec<(PathBuf, String)>) {
        let entries = std::fs::read_dir(dir).unwrap_or_else(|e| panic!("{}: {e}", dir.display()));
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, out);
            } else if p.extension().is_some_and(|x| x == "rs") {
                let text = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()));
                out.push((p, text));
            }
        }
    }
    let mut out = Vec::new();
    walk(&app_dir().join("src"), &mut out);
    assert!(out.len() >= 5, "found only {} sources under app/src", out.len());
    out
}
