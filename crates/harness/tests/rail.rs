//! F-035: the course rail through `lecter-harness course list | add | reorder`: courses join the
//! rail once, a new order persists in the data folder's state.db (D-188), a missing folder lists
//! as missing.

#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::path::Path;
use std::process::{Command, Output};

use lecter_core::testenv::TestEnv;
use serde_json::{Value, json};

fn harness(env: &TestEnv, args: &[&str]) -> Output {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_lecter-harness"));
    env.apply(&mut cmd).current_dir(env.home()).args(["--json"]).args(args);
    cmd.output().unwrap_or_else(|e| panic!("run lecter-harness: {e}"))
}

fn ok_json(out: &Output) -> Value {
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let text = std::str::from_utf8(&out.stdout).unwrap_or_else(|e| panic!("{e}"));
    serde_json::from_str(text.trim_end()).unwrap_or_else(|e| panic!("not JSON ({e}): {text:?}"))
}

/// A course folder `name` in the test home; its canonical path.
fn folder(env: &TestEnv, name: &str) -> String {
    let p = env.home().join(name);
    std::fs::create_dir_all(&p).unwrap_or_else(|e| panic!("{e}"));
    std::fs::canonicalize(&p).unwrap_or_else(|e| panic!("{e}")).to_str().unwrap_or_default().to_owned()
}

fn paths(v: &Value) -> Vec<&str> {
    v.as_array().map(|a| a.iter().filter_map(|c| c["path"].as_str()).collect()).unwrap_or_default()
}

#[test]
fn courses_join_once_reorder_and_persist() {
    let env = TestEnv::new().unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(ok_json(&harness(&env, &["course", "list"])), json!([]));
    let stat = folder(&env, "STAT311 Probability");
    let bio = folder(&env, "biology");
    ok_json(&harness(&env, &["course", "add", "STAT311 Probability"]));
    ok_json(&harness(&env, &["course", "add", "biology"]));
    let list = ok_json(&harness(&env, &["course", "add", "biology"]));
    assert_eq!(paths(&list), vec![stat.as_str(), bio.as_str()]);
    assert_eq!(
        list[0],
        json!({"path": stat, "name": "Probability", "icon": "S", "color": "#3584e4", "missing": false})
    );
    let list = ok_json(&harness(&env, &["course", "reorder", &bio, &stat]));
    assert_eq!(paths(&list), vec![bio.as_str(), stat.as_str()]);
    // A new process reads the saved order.
    assert_eq!(paths(&ok_json(&harness(&env, &["course", "list"]))), vec![bio.as_str(), stat.as_str()]);
    assert!(env.dirs().data().join("state.db").is_file());
}

#[test]
fn a_wrong_order_is_refused_and_a_missing_folder_lists_as_missing() {
    let env = TestEnv::new().unwrap_or_else(|e| panic!("{e}"));
    let stat = folder(&env, "stat");
    ok_json(&harness(&env, &["course", "add", "stat"]));
    let out = harness(&env, &["course", "reorder", &stat, "/elsewhere"]);
    assert!(!out.status.success());
    let err: Value = serde_json::from_slice(&out.stdout).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(err["error"]["code"], "E_INVALID_ARGUMENT", "{err}");
    std::fs::remove_dir(Path::new(&stat)).unwrap_or_else(|e| panic!("{e}"));
    let list = ok_json(&harness(&env, &["course", "list"]));
    assert_eq!(list[0]["missing"], true);
    assert_eq!(list[0]["name"], "stat");
}
