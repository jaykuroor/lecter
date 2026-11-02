//! `lecter-harness` is never part of an app bundle (F-015, `01-architecture.md#repository-layout`).
//!
//! Nothing that ships can pull it in: no other manifest names the crate, no Tauri config bundles a
//! harness binary, and the crate can't be published. `scripts/check_release_binary.sh` (CI job
//! `release-check`) also fails a release app binary that contains the string `lecter-harness`.

use std::path::{Path, PathBuf};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn read(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// Every `Cargo.toml` in the workspace members' folders and the root.
fn manifests() -> Vec<PathBuf> {
    let root = repo_root();
    let mut out = vec![root.join("Cargo.toml"), root.join("app/Cargo.toml")];
    for group in ["crates", "tests", "spikes"] {
        let Ok(entries) = std::fs::read_dir(root.join(group)) else { continue };
        for entry in entries.flatten() {
            let manifest = entry.path().join("Cargo.toml");
            if manifest.is_file() {
                out.push(manifest);
            }
        }
    }
    out
}

#[test]
fn no_other_manifest_depends_on_the_harness() {
    let own = repo_root().join("crates/harness/Cargo.toml");
    let found: Vec<String> = manifests()
        .into_iter()
        .filter(|m| m != &own && read(m).contains("lecter-harness"))
        .map(|m| m.display().to_string())
        .collect();
    assert!(manifests().len() > 5, "found too few manifests to be meaningful");
    assert!(found.is_empty(), "these manifests name lecter-harness: {found:?}");
}

#[test]
fn no_tauri_config_bundles_a_harness_binary() {
    let app = repo_root().join("app");
    let configs: Vec<PathBuf> = std::fs::read_dir(&app)
        .unwrap_or_else(|e| panic!("{}: {e}", app.display()))
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("tauri") && n.ends_with(".json"))
        })
        .collect();
    assert!(!configs.is_empty(), "no tauri*.json in app/");
    for conf in configs {
        assert!(!read(&conf).contains("harness"), "{} mentions the harness", conf.display());
    }
}

#[test]
fn the_harness_crate_cannot_be_published() {
    let own = read(&repo_root().join("crates/harness/Cargo.toml"));
    let root = read(&repo_root().join("Cargo.toml"));
    let inherits = own.lines().any(|l| l.trim() == "publish.workspace = true");
    let ws_false = root.lines().any(|l| l.trim() == "publish = false");
    let own_false = own.lines().any(|l| l.trim() == "publish = false");
    assert!(own_false || (inherits && ws_false), "crates/harness must have publish = false");
}
