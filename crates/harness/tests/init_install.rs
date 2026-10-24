//! `scripts/init.sh`'s install step under CI (CI-4ec6f29, Q-005 SEC-50): CI's setup action runs
//! init.sh, so an unlocked fallback there would rewrite a stale Cargo.lock or pnpm-lock.yaml and turn
//! a mismatched PR green. Runs the real script with every tool stubbed and records what it calls.
#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::process::Command;

mod common;
use common::bare_path;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Stub cargo: `fetch --locked` fails when FAIL_CARGO is set, as it does when Cargo.lock is stale.
const CARGO: &str = r#"echo "cargo $*" >> "$CALLS"
case " $* " in *" fetch "*"--locked "*) [ -z "$FAIL_CARGO" ] || exit 101 ;; esac
exit 0"#;

/// Stub pnpm: `install --frozen-lockfile` fails when FAIL_PNPM is set, as it does when the lock is stale.
const PNPM: &str = r#"echo "pnpm $*" >> "$CALLS"
case " $* " in *" install "*"--frozen-lockfile "*) [ -z "$FAIL_PNPM" ] || exit 1 ;; esac
exit 0"#;

/// Stub node: reports the version ui/package.json pins (init.sh runs from the repo root).
const NODE: &str = r#"printf 'v%s\n' "$(sed -n 's/^ *"node": *"\([0-9.]*\)".*/\1/p' ui/package.json | head -n 1)""#;

struct Run {
    code: i32,
    out: String,
    calls: Vec<String>,
}

/// Runs init.sh (no arguments) with stubbed tools; `env` adds CI, FAIL_CARGO and FAIL_PNPM.
fn init(env: &[(&str, &str)]) -> Result<Run, String> {
    let ok = "exit 0";
    let dir = bare_path(&[
        ("cargo", CARGO),
        ("pnpm", PNPM),
        ("node", NODE),
        ("git", ok),
        ("python3", ok),
        ("gitleaks", ok),
        ("pkg-config", ok),
        ("bwrap", ok),
        ("socat", ok),
        ("xvfb-run", ok),
        ("pdftotext", ok),
        ("cargo-nextest", ok),
        ("cargo-deny", ok),
        ("cargo-audit", ok),
    ])?;
    let calls = dir.path().join("calls.log");
    std::fs::write(&calls, "").map_err(|e| e.to_string())?;
    let mut cmd = Command::new(dir.path().join("bash"));
    cmd.arg(repo_root().join("scripts/init.sh"))
        .env_clear()
        .env("PATH", dir.path())
        .env("HOME", dir.path())
        .env("TMPDIR", dir.path())
        .env("PLAYWRIGHT_BROWSERS_PATH", dir.path())
        .env("LECTER_NODE_FALLBACK", dir.path().join("no-node-24"))
        .env("CALLS", &calls);
    for (k, v) in env {
        cmd.env(k, v);
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    let calls = std::fs::read_to_string(&calls).map_err(|e| e.to_string())?;
    Ok(Run {
        code: out.status.code().unwrap_or(-1),
        out: format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)),
        calls: calls.lines().map(String::from).collect(),
    })
}

fn is_install(call: &str) -> bool {
    call.starts_with("cargo fetch")
        || call.starts_with("cargo build")
        || call.contains(" install ") && call.starts_with("pnpm -C ui")
}

fn is_locked(call: &str) -> bool {
    call.contains("--locked") || call.contains("--frozen-lockfile")
}

#[test]
fn under_ci_init_installs_only_from_the_lockfiles() -> Result<(), String> {
    let r = init(&[("CI", "true")])?;
    if r.code != 0 || !r.out.contains("INIT OK") {
        return Err(format!("init.sh failed with matching lockfiles ({}):\n{}", r.code, r.out));
    }
    let installs: Vec<&String> = r.calls.iter().filter(|c| is_install(c)).collect();
    for want in ["cargo fetch", "cargo build", "pnpm -C ui install"] {
        if !installs.iter().any(|c| c.starts_with(want)) {
            return Err(format!("`{want}` never ran:\n{}", r.calls.join("\n")));
        }
    }
    match installs.iter().find(|c| !is_locked(c)) {
        Some(c) => Err(format!("unlocked install under CI: `{c}`")),
        None => Ok(()),
    }
}

#[test]
fn under_ci_a_stale_cargo_lock_fails_without_an_unlocked_retry() -> Result<(), String> {
    let r = init(&[("CI", "true"), ("FAIL_CARGO", "1")])?;
    if r.code == 0 || r.out.contains("INIT OK") {
        return Err(format!("init.sh passed with a stale Cargo.lock:\n{}", r.out));
    }
    if let Some(c) = r.calls.iter().find(|c| is_install(c) && !is_locked(c)) {
        return Err(format!("unlocked retry under CI: `{c}`"));
    }
    if !r.out.contains("Cargo.lock") {
        return Err(format!("the failure doesn't name Cargo.lock:\n{}", r.out));
    }
    Ok(())
}

#[test]
fn under_ci_a_stale_pnpm_lock_fails_without_an_unfrozen_retry() -> Result<(), String> {
    let r = init(&[("CI", "true"), ("FAIL_PNPM", "1")])?;
    if r.code == 0 || r.out.contains("INIT OK") {
        return Err(format!("init.sh passed with a stale pnpm-lock.yaml:\n{}", r.out));
    }
    if let Some(c) = r.calls.iter().find(|c| is_install(c) && !is_locked(c)) {
        return Err(format!("unfrozen retry under CI: `{c}`"));
    }
    if !r.out.contains("ui/pnpm-lock.yaml") {
        return Err(format!("the failure doesn't name ui/pnpm-lock.yaml:\n{}", r.out));
    }
    Ok(())
}

#[test]
fn locally_a_stale_lockfile_still_falls_back_to_an_unlocked_install() -> Result<(), String> {
    let r = init(&[("FAIL_CARGO", "1"), ("FAIL_PNPM", "1")])?;
    if r.code != 0 || !r.out.contains("INIT OK") {
        return Err(format!("local init.sh should recover from stale lockfiles ({}):\n{}", r.code, r.out));
    }
    for (what, unlocked) in [("cargo fetch", "cargo fetch -q"), ("pnpm install", "pnpm -C ui install --reporter")] {
        if !r.calls.iter().any(|c| c.starts_with(unlocked)) {
            return Err(format!("no unlocked {what} fallback:\n{}", r.calls.join("\n")));
        }
    }
    Ok(())
}
