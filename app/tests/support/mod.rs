//! Shared helpers for the shell's config tests: read files relative to `app/`.

use std::path::{Path, PathBuf};

pub fn app_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

pub fn read(rel: impl AsRef<Path>) -> String {
    let p = app_dir().join(rel);
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
}

pub fn json(rel: impl AsRef<Path>) -> serde_json::Value {
    let rel = rel.as_ref();
    serde_json::from_str(&read(rel)).unwrap_or_else(|e| panic!("{}: {e}", rel.display()))
}

pub fn conf() -> serde_json::Value {
    json("tauri.conf.json")
}
