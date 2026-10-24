//! F-012 criterion 2 (SEC-31): the main window's capability lists only the commands the shell
//! registers, and no capability names a remote URL.

mod support;

use support::{app_dir, conf, json};

include!("../src/ipc/names.rs");

fn capability_files() -> Vec<std::path::PathBuf> {
    let dir = app_dir().join("capabilities");
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .flatten()
        .map(|e| e.path())
        .collect();
    files.sort();
    files
}

#[test]
fn main_capability_grants_exactly_the_shell_commands() {
    let cap = json("capabilities/main.json");
    assert_eq!(cap["identifier"], "main");
    assert_eq!(cap["windows"], serde_json::json!(["main"]), "one capability file per window");
    let granted: Vec<String> = cap["permissions"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|p| p.as_str().unwrap_or_else(|| panic!("permission {p} is not a plain name")).to_owned())
        .collect();
    let expected: Vec<String> = COMMANDS.iter().map(|c| format!("allow-{}", c.replace('_', "-"))).collect();
    assert_eq!(granted, expected, "main.json must grant the shell's commands and nothing else");
}

#[test]
fn every_capability_is_enabled_by_name_and_local_only() {
    let files = capability_files();
    assert_eq!(files.len(), 1, "v0 has one window, so one capability file: {files:?}");
    let enabled = conf()["app"]["security"]["capabilities"].clone();
    for f in &files {
        let rel = f.strip_prefix(app_dir()).unwrap_or(f);
        let cap = json(rel);
        assert!(
            enabled.as_array().is_some_and(|a| a.contains(&cap["identifier"])),
            "{rel:?} is not enabled in tauri.conf.json"
        );
        assert!(cap.get("remote").is_none(), "{rel:?} grants remote URLs");
        let text = support::read(rel);
        for scheme in ["http://", "https://", "ws://", "wss://"] {
            assert!(!text.contains(scheme), "{rel:?} names a {scheme} URL");
        }
    }
}

#[test]
fn the_ui_calls_only_registered_commands() {
    let ui = support::read("../ui/src/core/commands.ts");
    let body = ui.split("export interface Commands {").nth(1).and_then(|s| s.split('}').next()).unwrap_or("");
    let called: Vec<&str> = body
        .lines()
        .filter_map(|l| l.trim().split_once(':').map(|(n, _)| n.trim()))
        .filter(|n| !n.is_empty())
        .collect();
    assert!(!called.is_empty(), "no commands found in commands.ts");
    for c in &called {
        assert!(COMMANDS.contains(c), "the UI calls {c}, which the shell does not register");
    }
}
