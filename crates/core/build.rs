//! Reads the bundle identifier from `app/tauri.conf.json`, its one source, into the
//! `LECTER_APP_ID` compile-time variable behind `identity::APP_ID`
//! (`01-architecture.md#app-identity-and-migration`).

use std::path::Path;

#[allow(clippy::disallowed_methods, reason = "a build script runs before any async runtime exists")]
fn main() {
    let conf = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../app/tauri.conf.json");
    println!("cargo:rerun-if-changed={}", conf.display());
    let text = match std::fs::read_to_string(&conf) {
        Ok(t) => t,
        Err(e) => panic!("cannot read {}: {e}", conf.display()),
    };
    match identifier(&text) {
        Some(id) => println!("cargo:rustc-env=LECTER_APP_ID={id}"),
        None => panic!("{} has no \"identifier\" string", conf.display()),
    }
}

/// The value of the first `"identifier": "<value>"` pair. Tauri's config has exactly one, at the
/// top level, and identifiers are plain reverse-DNS (no escapes), so no JSON parser is needed.
fn identifier(text: &str) -> Option<&str> {
    let rest = &text[text.find("\"identifier\"")? + "\"identifier\"".len()..];
    let rest = rest.trim_start().strip_prefix(':')?.trim_start().strip_prefix('"')?;
    let value = &rest[..rest.find('"')?];
    let valid = !value.is_empty()
        && value.split('.').count() >= 2
        && value.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    valid.then_some(value)
}
