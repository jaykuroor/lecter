//! The `lecter-harness` binary's calling convention (F-015): one JSON result per `--json` call,
//! errors as `{"error":{"code":…}}` with a non-zero exit, and `version`.
//!
//! Every run gets a throwaway `LECTER_TEST_HOME` (`TestEnv`), so no call can reach real folders.

use std::path::Path;
use std::process::{Command, Output};

use lecter_core::testenv::TestEnv;
use serde_json::Value;

/// Runs the harness binary with `args` inside a fresh test home.
fn harness(args: &[&str]) -> Output {
    let env = TestEnv::new().unwrap_or_else(|e| panic!("test home: {e}"));
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_lecter-harness"));
    env.apply(&mut cmd).args(args);
    cmd.output().unwrap_or_else(|e| panic!("run lecter-harness: {e}"))
}

fn stdout(out: &Output) -> &str {
    std::str::from_utf8(&out.stdout).unwrap_or_else(|e| panic!("stdout is not UTF-8: {e}"))
}

/// The single JSON value a `--json` call printed: exactly one line, newline-terminated.
fn one_json(out: &Output) -> Value {
    let text = stdout(out);
    assert!(text.ends_with('\n'), "no trailing newline: {text:?}");
    assert_eq!(text.lines().count(), 1, "expected one JSON line, got {text:?}");
    serde_json::from_str(text.trim_end()).unwrap_or_else(|e| panic!("not JSON ({e}): {text:?}"))
}

/// `[workspace.package] version` from the root Cargo.toml.
fn workspace_version() -> String {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../Cargo.toml");
    let text = std::fs::read_to_string(&root).unwrap_or_else(|e| panic!("{}: {e}", root.display()));
    let mut in_package = false;
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            in_package = line == "[workspace.package]";
        } else if in_package
            && let Some((k, v)) = line.split_once('=')
            && k.trim() == "version"
        {
            return v.trim().trim_matches('"').to_owned();
        }
    }
    panic!("no [workspace.package] version in {}", root.display());
}

/// Asserts `out` is a `--json` error with `code`, a message, and a non-zero exit.
fn assert_json_error(out: &Output, code: &str) {
    assert!(!out.status.success(), "exit {:?} for an error", out.status.code());
    let v = one_json(out);
    let err = v.get("error").unwrap_or_else(|| panic!("no \"error\" key: {v}"));
    assert_eq!(err["code"], code, "{v}");
    assert!(err["message"].as_str().is_some_and(|m| !m.is_empty()), "no message: {v}");
    assert_eq!(err["retryable"], false, "{v}");
    assert_eq!(v.as_object().map(|o| o.len()), Some(1), "only the error key: {v}");
}

#[test]
fn version_json_prints_one_object_with_the_workspace_version() {
    let out = harness(&["version", "--json"]);
    assert!(out.status.success(), "exit {:?}", out.status.code());
    assert!(out.stderr.is_empty(), "stderr: {}", String::from_utf8_lossy(&out.stderr));
    let v = one_json(&out);
    assert_eq!(v, serde_json::json!({ "version": workspace_version() }));
}

#[test]
fn json_flag_may_come_before_the_command() {
    let out = harness(&["--json", "version"]);
    assert!(out.status.success());
    assert_eq!(one_json(&out)["version"], workspace_version());
}

#[test]
fn version_without_json_prints_name_and_version_as_text() {
    let out = harness(&["version"]);
    assert!(out.status.success());
    assert_eq!(stdout(&out), format!("lecter-harness {}\n", workspace_version()));
}

#[test]
fn unknown_command_is_an_invalid_argument_error() {
    let out = harness(&["frobnicate", "--json"]);
    assert_json_error(&out, "E_INVALID_ARGUMENT");
    assert_eq!(out.status.code(), Some(2));
    let msg = one_json(&out)["error"]["message"].as_str().unwrap_or_default().to_owned();
    assert!(msg.contains("frobnicate") && msg.contains("version"), "names the command and the choices: {msg}");
}

#[test]
fn missing_command_is_an_invalid_argument_error() {
    assert_json_error(&harness(&["--json"]), "E_INVALID_ARGUMENT");
}

#[test]
fn unknown_flag_is_an_invalid_argument_error() {
    assert_json_error(&harness(&["version", "--jsn", "--json"]), "E_INVALID_ARGUMENT");
}

#[test]
fn version_takes_no_arguments() {
    assert_json_error(&harness(&["version", "extra", "--json"]), "E_INVALID_ARGUMENT");
}

#[test]
fn errors_without_json_go_to_stderr_with_their_code() {
    let out = harness(&["frobnicate"]);
    assert_eq!(out.status.code(), Some(2));
    assert!(out.stdout.is_empty(), "stdout: {}", stdout(&out));
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.contains("E_INVALID_ARGUMENT"), "stderr: {err}");
}
