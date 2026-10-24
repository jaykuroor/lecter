//! F-012 criteria 1, 3 and 5: identifier, version, CSP, devtools and the identifier's one source.

#![allow(clippy::disallowed_methods, reason = "tests read repo files on plain test threads, not on an async runtime")]

mod support;

use std::path::Path;
use support::{app_dir, conf, read};

/// SEC-30, exactly (13-security.md#tauri-and-ipc).
const SEC_30_CSP: &str = "default-src 'self'; img-src 'self' lecter: data:; style-src 'self' 'unsafe-inline'; \
script-src 'self'; connect-src ipc: http://ipc.localhost; object-src 'none'; frame-src lecter-fig:";

#[test]
fn tauri_conf_sets_identifier_version_and_the_sec_30_csp() {
    let c = conf();
    // The expected identifier comes from the spec (docs/ is not code), so no second copy exists.
    assert_eq!(c["identifier"], spec_identifier());
    assert_eq!(c["version"], "0.0.1");
    assert_eq!(c["version"], env!("CARGO_PKG_VERSION"), "tauri.conf.json and the workspace version differ");
    assert_eq!(c["app"]["security"]["csp"], SEC_30_CSP);
}

#[test]
fn dev_csp_differs_from_sec_30_only_by_the_vite_hot_reload_socket() {
    let dev = conf()["app"]["security"]["devCsp"].as_str().unwrap_or_default().to_owned();
    let port = dev_port();
    let expected = SEC_30_CSP.replace("http://ipc.localhost;", &format!("http://ipc.localhost ws://127.0.0.1:{port};"));
    assert_eq!(dev, expected);
}

#[test]
fn the_shell_has_one_main_window_on_the_ui() {
    let c = conf();
    let windows = c["app"]["windows"].as_array().cloned().unwrap_or_default();
    assert_eq!(windows.len(), 1, "exactly one window");
    assert_eq!(windows[0]["label"], "main");
    assert_eq!(c["build"]["frontendDist"], "../ui/dist");
    assert_eq!(c["build"]["devUrl"], format!("http://127.0.0.1:{}", dev_port()));
    assert_eq!(c["app"]["withGlobalTauri"], false, "no window.__TAURI__ global");
}

/// SEC-34: release builds have no devtools. Tauri enables them in debug builds, and in release
/// only with its `devtools` cargo feature or a window that asks for them.
#[test]
fn release_config_has_devtools_disabled() {
    let manifest: toml_lite::Manifest = toml_lite::parse(&read("Cargo.toml"));
    assert!(!manifest.tauri_features.iter().any(|f| f == "devtools"), "tauri's devtools feature is on");
    assert!(!manifest.has_feature_naming("tauri/devtools"), "a lecter-app feature turns on tauri/devtools");
    for w in conf()["app"]["windows"].as_array().cloned().unwrap_or_default() {
        assert_ne!(w["devtools"], true, "window {} asks for devtools", w["label"]);
    }
    for src in rust_sources(&app_dir().join("src")) {
        let text = std::fs::read_to_string(&src).unwrap_or_default();
        for needle in ["open_devtools", ".devtools(true)"] {
            assert!(!text.contains(needle), "{} calls {needle}", src.display());
        }
    }
}

/// Criterion 5: the identifier is spelled out only in app/tauri.conf.json, and Rust reads it at
/// build time into lecter_core::identity::APP_ID.
#[test]
fn identifier_has_one_source_read_into_app_id() {
    let id = conf()["identifier"].as_str().unwrap_or_default().to_owned();
    assert_eq!(lecter_core::identity::APP_ID, id);
    let parts: Vec<&str> = id.split('.').collect();
    assert!(parts.len() >= 3 && parts.iter().all(|p| !p.is_empty()), "{id} is not reverse-DNS");
    let app = app_dir();
    let root = app.parent().unwrap_or(&app);
    // Every tracked or new (not ignored) file outside docs/, the spec and plan that may name it.
    let out = std::process::Command::new("git")
        .args(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
        .current_dir(root)
        .output()
        .unwrap_or_else(|e| panic!("git ls-files: {e}"));
    assert!(out.status.success(), "git ls-files failed");
    let files: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .split('\0')
        .filter(|f| !f.is_empty() && !f.starts_with("docs/"))
        .map(str::to_owned)
        .collect();
    assert!(files.len() > 50, "git ls-files listed only {} files", files.len());
    let offenders: Vec<&String> = files
        .iter()
        .filter(|f| f.as_str() != "app/tauri.conf.json")
        .filter(|f| std::fs::read(root.join(f)).is_ok_and(|b| String::from_utf8_lossy(&b).contains(&id)))
        .collect();
    assert!(offenders.is_empty(), "the identifier is spelled out in {offenders:?}");
}

/// SEC-30/31/34: a release build must embed the UI (Tauri's `custom-protocol`). Without it the
/// binary loads devUrl, and the main capability's IPC would reach whatever binds that port.
#[test]
fn release_builds_cannot_compile_without_the_embedded_ui() {
    let manifest = read("Cargo.toml");
    let features = manifest.split("\n[features]").nth(1).and_then(|s| s.split("\n[").next()).unwrap_or("");
    assert!(
        features.lines().any(|l| l.replace(' ', "") == "custom-protocol=[\"tauri/custom-protocol\"]"),
        "lecter-app needs a custom-protocol feature that turns on tauri/custom-protocol"
    );
    let main = read("src/main.rs");
    let guard = main.find("#[cfg(all(dev, not(debug_assertions)))]").unwrap_or_else(|| panic!("no release guard"));
    assert!(
        main[guard..].lines().nth(1).is_some_and(|l| l.starts_with("compile_error!(")),
        "guard is not a compile_error!"
    );
}

/// The identifier as the spec states it (01-architecture.md#app-identity-and-migration).
fn spec_identifier() -> String {
    let spec = read("../docs/spec/01-architecture.md");
    let marker = "The bundle identifier is `";
    let start = spec.find(marker).unwrap_or_else(|| panic!("spec no longer states the identifier")) + marker.len();
    spec[start..].split('`').next().unwrap_or_default().to_owned()
}

fn dev_port() -> String {
    let script = read("../scripts/dev.sh");
    let line = script.lines().find(|l| l.starts_with("PORT=")).unwrap_or_else(|| panic!("dev.sh sets no PORT="));
    line.trim_start_matches("PORT=").trim().to_owned()
}

fn rust_sources(dir: &Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    walk(dir, &mut out);
    out.retain(|p| p.extension().is_some_and(|e| e == "rs"));
    out
}

fn walk(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        let name = e.file_name();
        let skip = ["target", "node_modules", "dist", "gen", ".git", "private"];
        if p.is_dir() {
            if !skip.iter().any(|s| name == *s) {
                walk(&p, out);
            }
        } else {
            out.push(p);
        }
    }
}

/// Just enough of Cargo.toml to see which tauri features are on (no TOML crate needed).
mod toml_lite {
    pub struct Manifest {
        pub tauri_features: Vec<String>,
        features_section: String,
    }

    impl Manifest {
        pub fn has_feature_naming(&self, needle: &str) -> bool {
            self.features_section.contains(needle)
        }
    }

    pub fn parse(text: &str) -> Manifest {
        let tauri_line =
            text.lines().find(|l| l.trim_start().starts_with("tauri ") || l.trim_start().starts_with("tauri="));
        let tauri_features = tauri_line
            .and_then(|l| l.split_once("features"))
            .map(|(_, rest)| {
                let list = rest.split_once('[').and_then(|(_, r)| r.split_once(']')).map(|(l, _)| l).unwrap_or("");
                list.split(',').map(|f| f.trim().trim_matches('"').to_owned()).filter(|f| !f.is_empty()).collect()
            })
            .unwrap_or_default();
        let features_section = text
            .split("\n[features]")
            .nth(1)
            .map(|s| s.split("\n[").next().unwrap_or("").to_owned())
            .unwrap_or_default();
        Manifest { tauri_features, features_section }
    }
}
