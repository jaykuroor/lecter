//! F-022 criterion 3: `lecter-harness search <course> <query>` prints the hits as JSON: each
//! with its lecture, slide and block id and text, best BM25 score first.

#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use lecter_core::testenv::TestEnv;
use serde_json::Value;

fn env() -> TestEnv {
    TestEnv::new().unwrap_or_else(|e| panic!("test home: {e}"))
}

fn harness(env: &TestEnv, cwd: &Path, args: &[&str]) -> Output {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_lecter-harness"));
    env.apply(&mut cmd).current_dir(cwd).args(args);
    cmd.output().unwrap_or_else(|e| panic!("run lecter-harness: {e}"))
}

fn one_json(out: &Output) -> Value {
    let text = std::str::from_utf8(&out.stdout).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(text.lines().count(), 1, "{text:?}");
    serde_json::from_str(text.trim_end()).unwrap_or_else(|e| panic!("not JSON ({e}): {text:?}"))
}

/// A synthetic course with two lectures (English only).
fn sample_course(env: &TestEnv) -> PathBuf {
    let course = env.home().join("Sample Course");
    let lectures = course.join("lectures");
    std::fs::create_dir_all(&lectures).unwrap_or_else(|e| panic!("{e}"));
    let l01 = "---\ntitle: Introduction\n---\n\n::: {.slide #s1 n=1 title=\"Welcome\"}\n## Welcome\n\n[Probability measures uncertainty.]{#s1b1}\n\n[Sample spaces list outcomes.]{#s1b2}\n:::\n";
    let l02 = "---\ntitle: Expectation\n---\n\n::: {.slide #s4 n=4 title=\"Linearity\"}\n## Linearity\n\n[Expectation is linear.]{#s4b1 .flag}\n\n[The expectation of a sample mean equals the population mean.]{#s4b2}\n:::\n";
    std::fs::write(lectures.join("2026-09-02-l01-introduction.md"), l01).unwrap_or_else(|e| panic!("{e}"));
    std::fs::write(lectures.join("2026-09-09-l02-expectation.md"), l02).unwrap_or_else(|e| panic!("{e}"));
    course
}

/// The (lecture, slide, block, text) of each hit, in order.
fn rows(v: &Value) -> Vec<(String, String, String, String)> {
    let s = |h: &Value, k: &str| h[k].as_str().unwrap_or_else(|| panic!("{k} missing in {h}")).to_owned();
    v.as_array()
        .unwrap_or_else(|| panic!("not an array: {v}"))
        .iter()
        .map(|h| (s(h, "lecture"), s(h, "slide"), s(h, "block"), s(h, "text")))
        .collect()
}

#[test]
fn search_prints_the_ranked_hits_as_json() {
    let env = env();
    let course = sample_course(&env);
    let out = harness(&env, env.home(), &["search", "Sample Course", "sample", "--json"]);
    assert_eq!(out.status.code(), Some(0), "{}", String::from_utf8_lossy(&out.stderr));
    let v = one_json(&out);
    let row = |l: &str, s: &str, b: &str, t: &str| (l.to_owned(), s.to_owned(), b.to_owned(), t.to_owned());
    // "sample" is once in each of two blocks: the shorter one ranks first (BM25 length
    // normalisation), and nothing else matches.
    assert_eq!(
        rows(&v),
        [
            row("lectures/2026-09-02-l01-introduction.md", "s1", "s1b2", "Sample spaces list outcomes."),
            row(
                "lectures/2026-09-09-l02-expectation.md",
                "s4",
                "s4b2",
                "The expectation of a sample mean equals the population mean."
            ),
        ]
    );
    let scores: Vec<f64> = v.as_array().into_iter().flatten().filter_map(|h| h["score"].as_f64()).collect();
    assert_eq!(scores.len(), 2);
    assert!(scores[0] > scores[1] && scores[1] > 0.0, "{scores:?}");
    assert_eq!(v[0]["breadcrumb"], "Introduction › Welcome");
    assert!(course.join(".lecter/cache/index/meta.json").is_file(), "the index is in the course cache");
}

#[test]
fn all_the_words_are_searched_and_the_best_match_comes_first() {
    let env = env();
    sample_course(&env);
    let out = harness(&env, env.home(), &["search", "Sample Course", "expectation", "linear", "--json"]);
    let v = one_json(&out);
    let got = rows(&v);
    assert_eq!(got[0].2, "s4b1", "{v}");
    assert_eq!(got.len(), 2, "{v}");
}

#[test]
fn no_match_is_an_empty_list() {
    let env = env();
    sample_course(&env);
    let out = harness(&env, env.home(), &["search", "Sample Course", "eigenvalue", "--json"]);
    assert_eq!(out.status.code(), Some(0));
    assert_eq!(one_json(&out), Value::Array(vec![]));
    let text = harness(&env, env.home(), &["search", "Sample Course", "eigenvalue"]);
    assert_eq!(String::from_utf8_lossy(&text.stdout), "no hits\n");
}

#[test]
fn a_missing_course_is_not_found_and_missing_words_a_bad_call() {
    let env = env();
    let out = harness(&env, env.home(), &["search", "Nope", "word", "--json"]);
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(one_json(&out)["error"]["code"], "E_NOT_FOUND");
    let out = harness(&env, env.home(), &["search", "Nope", "--json"]);
    assert_eq!(out.status.code(), Some(2));
    assert_eq!(one_json(&out)["error"]["code"], "E_INVALID_ARGUMENT");
}
