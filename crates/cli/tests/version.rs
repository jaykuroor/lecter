//! The v0 `lecter` binary prints its version and nothing else (F-010).

use std::process::Command;

fn run(args: &[&str]) -> Result<std::process::Output, String> {
    Command::new(env!("CARGO_BIN_EXE_lecter")).args(args).output().map_err(|e| format!("run lecter: {e}"))
}

#[test]
fn prints_only_its_version() -> Result<(), String> {
    let out = run(&[])?;
    assert!(out.status.success(), "exit status {:?}", out.status);
    assert_eq!(String::from_utf8_lossy(&out.stdout), "lecter 0.0.1\n");
    assert!(out.stderr.is_empty(), "stderr: {}", String::from_utf8_lossy(&out.stderr));
    Ok(())
}

#[test]
fn ignores_arguments_and_still_prints_only_its_version() -> Result<(), String> {
    let out = run(&["export", "--help"])?;
    assert!(out.status.success(), "exit status {:?}", out.status);
    assert_eq!(String::from_utf8_lossy(&out.stdout), "lecter 0.0.1\n");
    assert!(out.stderr.is_empty(), "stderr: {}", String::from_utf8_lossy(&out.stderr));
    Ok(())
}
