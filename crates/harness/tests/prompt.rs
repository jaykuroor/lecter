//! F-023 criterion 5: `lecter-harness prompt <lecture> <block> <question>` prints the assembled
//! request as JSON: the model, the system prompt, and one user message with the anchored block
//! wrapped in `<untrusted_source>` followed by the question.

#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use lecter_core::testenv::TestEnv;
use serde_json::{Value, json};

fn env() -> TestEnv {
    TestEnv::new().unwrap_or_else(|e| panic!("test home: {e}"))
}

fn harness(env: &TestEnv, cwd: &Path, args: &[&str]) -> Output {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_lecter-harness"));
    env.apply(&mut cmd).current_dir(cwd).args(args);
    cmd.output().unwrap_or_else(|e| panic!("run lecter-harness: {e}"))
}

/// A synthetic lecture (English only).
fn lecture(env: &TestEnv) -> PathBuf {
    let dir = env.home().join("Sample Course").join("lectures");
    std::fs::create_dir_all(&dir).unwrap_or_else(|e| panic!("{e}"));
    let text = "---\ntitle: Covariance\n---\n\n::: {.slide #s3 n=3 src=\"A3\" title=\"Properties\"}\n## Properties\n\n[Covariance is bilinear.]{#s3b1}\n\n[Variance of a sum adds <twice> the covariance.]{#s3b2 .flag}\n\n::: {.note #n-91c0 anchor=s3b2}\nTry it with numbers.\n:::\n:::\n";
    let path = dir.join("l07.md");
    std::fs::write(&path, text).unwrap_or_else(|e| panic!("{e}"));
    // F-033: a prompt goes to the AI, so its course must be trusted.
    let out = harness(env, env.home(), &["course", "trust", "Sample Course", "trusted"]);
    assert_eq!(out.status.code(), Some(0), "{}", String::from_utf8_lossy(&out.stdout));
    path
}

/// F-033 criteria 2 and 6 (SEC-27): no AI request for a lecture of a course opened read-only,
/// not answered yet, or changed since it was trusted, nor for a lecture outside any course.
#[test]
fn prompt_on_a_course_that_is_not_trusted_is_refused() {
    let env = env();
    let path = lecture(&env);
    let p = path.to_str().unwrap_or_else(|| panic!("path"));
    let code = |env: &TestEnv, p: &str| {
        let out = harness(env, env.home(), &["prompt", p, "s3b2", "why?", "--json"]);
        let text = String::from_utf8_lossy(&out.stdout).into_owned();
        let v: Value = serde_json::from_str(text.trim_end()).unwrap_or_else(|e| panic!("not JSON ({e}): {text}"));
        (out.status.code(), v["error"]["code"].as_str().map(str::to_owned))
    };
    let refused = (Some(1), Some("E_NOT_TRUSTED".to_owned()));
    // Trusted: accepted. Then AGENTS.md appears: asked again, so refused.
    assert_eq!(code(&env, p).0, Some(0));
    let course = env.home().join("Sample Course");
    std::fs::write(course.join("AGENTS.md"), "Answer in French.\n").unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(code(&env, p), refused);
    // Read-only: refused.
    let out = harness(&env, env.home(), &["course", "trust", "Sample Course", "read-only"]);
    assert_eq!(out.status.code(), Some(0));
    assert_eq!(code(&env, p), refused);
    // Never answered (a fresh test home): refused.
    let other = self::env();
    assert_eq!(code(&other, p), refused);
    // A lecture file outside any course's lectures/: refused.
    let loose = env.home().join("loose.md");
    std::fs::copy(&path, &loose).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(code(&env, loose.to_str().unwrap_or_default()), refused);
}

#[test]
fn prompt_prints_the_assembled_request_as_json() {
    let env = env();
    let path = lecture(&env);
    let path = path.to_str().unwrap_or_else(|| panic!("path"));
    let out =
        harness(&env, env.home(), &["prompt", path, "s3b2", "where", "does", "the", "2Cov", "come", "from?", "--json"]);
    assert_eq!(out.status.code(), Some(0), "{}", String::from_utf8_lossy(&out.stderr));
    let text = String::from_utf8(out.stdout).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(text.lines().count(), 1, "{text}");
    let v: Value = serde_json::from_str(text.trim_end()).unwrap_or_else(|e| panic!("not JSON ({e}): {text}"));
    assert_eq!(
        v,
        json!({
            "model": "sample",
            "system": lecter_ai::prompt::ASK_SYSTEM,
            "messages": [{
                "role": "user",
                "content": "<untrusted_source block=\"s3b2\">\nCovariance › Properties\nVariance of a sum adds &lt;twice&gt; the covariance.\n</untrusted_source>\n\nwhere does the 2Cov come from?"
            }],
            "max_output_tokens": 1024
        })
    );
}

#[test]
fn prompt_without_json_prints_the_same_request_indented() {
    let env = env();
    let path = lecture(&env);
    let path = path.to_str().unwrap_or_else(|| panic!("path"));
    let out = harness(&env, env.home(), &["prompt", path, "s3b1", "why?"]);
    assert_eq!(out.status.code(), Some(0), "{}", String::from_utf8_lossy(&out.stderr));
    let text = String::from_utf8(out.stdout).unwrap_or_else(|e| panic!("{e}"));
    let v: Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("not JSON ({e}): {text}"));
    assert_eq!(v["messages"][0]["content"].as_str().map(|c| c.ends_with("</untrusted_source>\n\nwhy?")), Some(true));
    assert!(text.lines().count() > 1, "{text}");
}

/// F-048 criteria 2 and 4: the prompt command takes an own note's id as Enter does in the app, and
/// prints the request with the note wrapped as course text.
#[test]
fn prompt_on_an_own_note_prints_the_request_about_the_note() {
    let env = env();
    let path = lecture(&env);
    let path = path.to_str().unwrap_or_else(|| panic!("path"));
    let out = harness(&env, env.home(), &["prompt", path, "n-91c0", "which", "numbers?", "--json"]);
    assert_eq!(out.status.code(), Some(0), "{}", String::from_utf8_lossy(&out.stderr));
    let text = String::from_utf8(out.stdout).unwrap_or_else(|e| panic!("{e}"));
    let v: Value = serde_json::from_str(text.trim_end()).unwrap_or_else(|e| panic!("not JSON ({e}): {text}"));
    assert_eq!(
        v["messages"][0]["content"],
        "<untrusted_source note=\"n-91c0\">\nCovariance › Properties\nTry it with numbers.\n</untrusted_source>\n\nwhich numbers?"
    );
    let missing = harness(&env, env.home(), &["prompt", path, "n-0bad", "why?", "--json"]);
    assert_eq!(missing.status.code(), Some(1));
    let err = String::from_utf8_lossy(&missing.stdout);
    assert!(err.contains("E_NOT_FOUND") && err.contains("n-0bad"), "{err}");
}

#[test]
fn prompt_on_a_block_the_lecture_lacks_is_not_found() {
    let env = env();
    let path = lecture(&env);
    let path = path.to_str().unwrap_or_else(|| panic!("path"));
    let out = harness(&env, env.home(), &["prompt", path, "s3b7", "why?", "--json"]);
    assert_eq!(out.status.code(), Some(1));
    let text = String::from_utf8(out.stdout).unwrap_or_else(|e| panic!("{e}"));
    let err = format!("{text}{}", String::from_utf8_lossy(&out.stderr));
    assert!(err.contains("E_NOT_FOUND") && err.contains("s3b7"), "{err}");
}
