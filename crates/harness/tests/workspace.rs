//! Repository-shape checks for the Cargo workspace (F-010).
//!
//! These read the root files directly so that a broken scaffold fails here,
//! with a message naming the file, before anything else depends on it.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Crate folders under `crates/` required by `01-architecture.md#repository-layout`.
const CRATE_FOLDERS: [&str; 8] = ["core", "parse", "models", "index", "ai", "cas", "harness", "cli"];

/// Licences allowed by `01-architecture.md#dependency-policy`, as SPDX ids.
const ALLOWED_LICENSES: [&str; 10] = [
    "MIT",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "ISC",
    "Zlib",
    "MPL-2.0",
    "Unicode-3.0",
    "Unicode-DFS-2016",
    "CC0-1.0",
];

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn read(rel: &str) -> Result<String, String> {
    std::fs::read_to_string(repo_root().join(rel)).map_err(|e| format!("{rel}: {e}"))
}

/// The lines of one `[table]` in a TOML file, without the header.
fn toml_table<'a>(text: &'a str, header: &str) -> Vec<&'a str> {
    let mut lines = text.lines().map(str::trim);
    let mut out = Vec::new();
    if lines.by_ref().any(|l| l == header) {
        out.extend(lines.take_while(|l| !l.starts_with('[')).filter(|l| !l.is_empty() && !l.starts_with('#')));
    }
    out
}

/// The string value of `key = "value"` in a list of table lines.
fn toml_str<'a>(lines: &[&'a str], key: &str) -> Option<&'a str> {
    lines.iter().find_map(|l| {
        let (k, v) = l.split_once('=')?;
        (k.trim() == key).then(|| v.trim().trim_matches('"'))
    })
}

/// Every quoted string inside the `key = [ ... ]` array of a TOML table.
fn toml_array(text: &str, header: &str, key: &str) -> Vec<String> {
    let mut in_table = false;
    let mut in_array = false;
    let mut out = Vec::new();
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') && !in_array {
            in_table = line == header;
            continue;
        }
        if !in_table {
            continue;
        }
        let body = if in_array {
            line
        } else if let Some((k, v)) = line.split_once('=')
            && k.trim() == key
        {
            in_array = true;
            v
        } else {
            continue;
        };
        let body = body.split('#').next().unwrap_or_default();
        out.extend(body.split('"').skip(1).step_by(2).map(String::from));
        if body.contains(']') {
            break;
        }
    }
    out
}

#[test]
fn workspace_contains_every_architecture_crate_and_the_fake_provider() -> Result<(), String> {
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".into());
    let out = Command::new(cargo)
        .args(["metadata", "--no-deps", "--format-version", "1", "--offline"])
        .current_dir(repo_root())
        .output()
        .map_err(|e| format!("cargo metadata: {e}"))?;
    if !out.status.success() {
        return Err(format!("cargo metadata failed: {}", String::from_utf8_lossy(&out.stderr)));
    }
    let meta = String::from_utf8_lossy(&out.stdout);
    let mut dirs: Vec<(String, String)> =
        CRATE_FOLDERS.iter().map(|f| (format!("crates/{f}"), format!("lecter-{f}"))).collect();
    dirs.push(("tests/fake-provider".into(), "lecter-fake-provider".into()));
    for (dir, name) in &dirs {
        let manifest = read(&format!("{dir}/Cargo.toml"))?;
        let package = toml_table(&manifest, "[package]");
        assert_eq!(toml_str(&package, "name"), Some(name.as_str()), "{dir}/Cargo.toml package name");
        assert!(meta.contains(&format!("\"name\":\"{name}\"")), "{name} is not a workspace member");
        let lib = read(&format!("{dir}/src/lib.rs")).or_else(|_| read(&format!("{dir}/src/main.rs")))?;
        assert!(lib.contains("#[test]"), "{dir} has no smoke test in its src");
    }
    Ok(())
}

#[test]
fn workspace_package_sets_version_0_0_1_and_edition_2024() -> Result<(), String> {
    let root = read("Cargo.toml")?;
    let package = toml_table(&root, "[workspace.package]");
    assert_eq!(toml_str(&package, "version"), Some("0.0.1"));
    assert_eq!(toml_str(&package, "edition"), Some("2024"));
    Ok(())
}

#[test]
fn toolchain_is_pinned_to_an_exact_stable_release() -> Result<(), String> {
    let text = read("rust-toolchain.toml")?;
    let channel = toml_str(&toml_table(&text, "[toolchain]"), "channel").ok_or("no [toolchain] channel")?;
    let parts: Vec<&str> = channel.split('.').collect();
    assert_eq!(parts.len(), 3, "channel {channel:?} must be an exact x.y.z release, not a moving name");
    assert!(parts.iter().all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit())), "channel {channel:?}");
    Ok(())
}

#[test]
fn deny_toml_allows_exactly_the_policy_licences() -> Result<(), String> {
    let text = read("deny.toml")?;
    let mut allowed = toml_array(&text, "[licenses]", "allow");
    allowed.sort();
    let mut expected: Vec<String> = ALLOWED_LICENSES.iter().map(|s| s.to_string()).collect();
    expected.sort();
    assert_eq!(allowed, expected);
    Ok(())
}

#[test]
fn deny_toml_denies_unknown_registries_and_git_sources() -> Result<(), String> {
    let text = read("deny.toml")?;
    let sources = toml_table(&text, "[sources]");
    assert_eq!(toml_str(&sources, "unknown-registry"), Some("deny"));
    assert_eq!(toml_str(&sources, "unknown-git"), Some("deny"));
    assert!(toml_array(&text, "[sources]", "allow-git").is_empty(), "no git sources are allowed");
    Ok(())
}

#[test]
fn gitattributes_forces_lf_and_marks_binary_fixtures() -> Result<(), String> {
    let text = read(".gitattributes")?;
    let rules: Vec<Vec<&str>> = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(|l| l.split_whitespace().collect())
        .collect();
    let rule = |pattern: &str| rules.iter().find(|r| r.first() == Some(&pattern)).cloned().unwrap_or_default();
    let all = rule("*");
    assert!(all.contains(&"text=auto") && all.contains(&"eol=lf"), "`*` must be `text=auto eol=lf`, got {all:?}");
    for ext in ["*.pdf", "*.pptx", "*.png", "*.jpg", "*.zip", "*.woff2"] {
        assert!(rule(ext).contains(&"binary"), "{ext} must be marked binary");
    }
    Ok(())
}
