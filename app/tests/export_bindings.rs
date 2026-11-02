//! F-017 criterion 2: `export-bindings -- --check` exits 0 on current bindings and non-zero on
//! stale ones (verify.sh `bindings-stale` relies on the exit status). Runs the real binary.

#![allow(clippy::disallowed_methods, reason = "tests run the binary and write fixtures on plain test threads")]

use std::path::Path;
use std::process::{Command, Output};

use lecter_core::testenv::TestEnv;

const BIN: &str = env!("CARGO_BIN_EXE_export-bindings");

fn run(args: &[&str]) -> Output {
    Command::new(BIN).args(args).output().unwrap_or_else(|e| panic!("{BIN}: {e}"))
}

fn status(out: &Output) -> Option<i32> {
    out.status.code()
}

fn arg(p: &Path) -> &str {
    p.to_str().unwrap_or_else(|| panic!("non-UTF-8 temp path {}", p.display()))
}

/// The committed `ui/src/core/bindings.ts`.
fn committed() -> String {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../ui/src/core/bindings.ts");
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
}

fn env() -> TestEnv {
    TestEnv::new().unwrap_or_else(|e| panic!("{e}"))
}

#[test]
fn check_passes_on_the_committed_bindings() {
    let out = run(&["--check"]);
    assert_eq!(status(&out), Some(0), "{}", String::from_utf8_lossy(&out.stderr));
}

#[test]
fn check_fails_on_stale_bindings() {
    let env = env();
    let stale = env.home().join("bindings.ts");
    std::fs::write(&stale, committed().replace("courseOpen", "courseOpenOld")).unwrap_or_else(|e| panic!("{e}"));
    let out = run(&["--check", "--bindings", arg(&stale)]);
    assert_eq!(status(&out), Some(1), "a stale file passed --check");
    assert!(String::from_utf8_lossy(&out.stderr).contains("stale"), "no 'stale' message");
    // --check never rewrites the file.
    assert!(std::fs::read_to_string(&stale).unwrap_or_default().contains("courseOpenOld"));
}

#[test]
fn check_fails_on_a_missing_file() {
    let env = env();
    let out = run(&["--check", "--bindings", arg(&env.home().join("none.ts"))]);
    assert_eq!(status(&out), Some(1));
}

#[test]
fn writing_then_checking_the_same_file_passes() {
    let env = env();
    let target = env.home().join("bindings.ts");
    assert_eq!(status(&run(&["--bindings", arg(&target)])), Some(0));
    let written = std::fs::read_to_string(&target).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(written.replace("\r\n", "\n"), committed().replace("\r\n", "\n"));
    assert_eq!(status(&run(&["--check", "--bindings", arg(&target)])), Some(0));
}

#[test]
fn a_bad_flag_is_a_usage_error() {
    for args in [&["--bogus"][..], &["--check", "extra"], &["--bindings"]] {
        let out = run(args);
        assert_eq!(status(&out), Some(2), "{args:?}");
        assert!(String::from_utf8_lossy(&out.stderr).contains("usage"), "{args:?}");
    }
}
