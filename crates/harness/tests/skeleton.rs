//! F-026 criterion 3: the walking skeleton's path with no GUI, through `lecter-harness` commands
//! and the core they run, on the same synthetic text PDF the real-app flow uses
//! (`tests/e2e/flows/skeleton.ts`): open a course, parse its slide PDF into a lecture, edit it,
//! restart (a new session replays what was saved), search it, assemble the gloss request and get
//! the sample provider's figure answer for it.
//!
//! The harness has no import or edit command yet (new lecture from slides is F-061), so the lecture
//! is written from `parse`'s blocks as `03-lecture-files.md#body` shows, and the edit goes through
//! the core's save session, as the app's `lecture_apply_edits` does.

#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use lecter_ai::figures::sample::{SAMPLE_PLOT_ANSWER, answer_for};
use lecter_ai::provider::{ChatRequest, Message, Role};
use lecter_core::save::{Edit, Session};
use lecter_core::testenv::TestEnv;
use serde_json::{Value, json};

const PDF: &str = "slides/12-entropy.pdf";
const LECTURE: &str = "lectures/2026-10-27-l12-entropy.md";
const TYPED: &str = "Clausius stated it first. ";
const FIRST: &str = "The second law says that the entropy of an isolated system never falls.";

/// The fixture's text as the parser reads it, written as `03-lecture-files.md#body` says.
const EXPECTED: &str = "---\nlecter: 1\nlecture: 12\ndate: 2026-10-27\ntitle: Entropy and heat\nslides:\n  - slides/12-entropy.pdf\n---\n\n\
::: {.slide #s1 n=1 title=\"Entropy and heat\"}\n## Entropy and heat\n\n\
[The second law says that the entropy of an isolated system never falls.]{#s1b2}\n\n\
[Heat flows from hot to cold.]{#s1b3}\n\n:::\n\n\
::: {.slide #s2 n=2 title=\"Worked example\"}\n## Worked example\n\n\
[A cup of tea cools in a room. Its entropy falls and the room gains more.]{#s2b2}\n\n:::\n";

fn harness(env: &TestEnv, args: &[&str]) -> Value {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_lecter-harness"));
    env.apply(&mut cmd).current_dir(env.home()).env_remove("LECTER_PDFIUM_DIR").args(args).arg("--json");
    let out: Output = cmd.output().unwrap_or_else(|e| panic!("run lecter-harness: {e}"));
    let text = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(0), "{args:?}: {text} / {}", String::from_utf8_lossy(&out.stderr));
    serde_json::from_str(text.trim_end()).unwrap_or_else(|e| panic!("not JSON ({e}): {text}"))
}

/// A synthetic course folder holding only the fixture PDF as its slides.
fn course(env: &TestEnv) -> PathBuf {
    let dir = env.home().join("Sample Course");
    std::fs::create_dir_all(dir.join("slides")).unwrap_or_else(|e| panic!("{e}"));
    std::fs::create_dir_all(dir.join("lectures")).unwrap_or_else(|e| panic!("{e}"));
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/pdf/text-two-pages.pdf");
    std::fs::copy(fixture, dir.join(PDF)).unwrap_or_else(|e| panic!("{e}"));
    std::fs::canonicalize(&dir).unwrap_or_else(|e| panic!("{e}"))
}

/// A block's text on one line, as the buffer and search read spans.
fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `parse`'s blocks as a lecture file: a slide per page, its first block the title, the rest spans.
fn lecture_file(parsed: &Value) -> String {
    let blocks = parsed["blocks"].as_array().unwrap_or_else(|| panic!("no blocks: {parsed}"));
    let mut pages: Vec<u64> = blocks.iter().filter_map(|b| b["page"].as_u64()).collect();
    pages.dedup();
    let text = |b: &Value| one_line(b["text"].as_str().unwrap_or_default());
    let mut out = format!(
        "---\nlecter: 1\nlecture: 12\ndate: 2026-10-27\ntitle: {}\nslides:\n  - {PDF}\n---\n\n",
        text(&blocks[0])
    );
    for page in pages {
        let on_page: Vec<&Value> = blocks.iter().filter(|b| b["page"].as_u64() == Some(page)).collect();
        let title = text(on_page[0]);
        out += &format!("::: {{.slide #s{page} n={page} title=\"{title}\"}}\n## {title}\n\n");
        for b in &on_page[1..] {
            out += &format!("[{}]{{#{}}}\n\n", text(b), b["id"].as_str().unwrap_or_default());
        }
        out += ":::\n\n";
    }
    out.truncate(out.len() - 1);
    out
}

#[test]
fn the_skeleton_path_runs_through_the_harness_with_no_gui() {
    let env = TestEnv::new().unwrap_or_else(|e| panic!("test home: {e}"));
    let dir = course(&env);
    let dir_s = dir.to_str().unwrap_or_else(|| panic!("path"));

    // Open the course: its slide PDF, no lectures yet.
    let listing = harness(&env, &["course", "open", dir_s]);
    assert_eq!(listing["slides"], json!([{ "name": "12-entropy.pdf", "path": PDF }]));
    assert_eq!(listing["lectures"], json!([]));

    // Parse the PDF in the worker and write its blocks as the lecture.
    let parsed = harness(&env, &["parse", dir.join(PDF).to_str().unwrap_or_default()]);
    let text = lecture_file(&parsed);
    assert_eq!(text, EXPECTED);
    std::fs::write(dir.join(LECTURE), &text).unwrap_or_else(|e| panic!("{e}"));
    let listing = harness(&env, &["course", "open", dir_s]);
    assert_eq!(listing["lectures"], json!([{ "name": "2026-10-27-l12-entropy.md", "path": LECTURE }]));

    // Edit the first block through the core's save session, then quit (which saves).
    let at = u32::try_from(EXPECTED.find(FIRST).unwrap_or_else(|| panic!("no first block"))).unwrap_or(u32::MAX);
    let (session, _) = Session::open(&dir, LECTURE).unwrap_or_else(|e| panic!("{e:?}"));
    session.apply(vec![Edit { from: at, to: at, text: TYPED.into() }]).unwrap_or_else(|e| panic!("{e:?}"));
    session.close().unwrap_or_else(|e| panic!("{e:?}"));
    drop(session);
    let edited = EXPECTED.replace(&format!("[{FIRST}]"), &format!("[{TYPED}{FIRST}]"));
    assert_eq!(std::fs::read_to_string(dir.join(LECTURE)).unwrap_or_default(), edited);

    // Restart: a new session sees the edit.
    let (again, opened) = Session::open(&dir, LECTURE).unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(opened.lecture.text, edited);
    again.close().unwrap_or_else(|e| panic!("{e:?}"));

    // Search finds the edited block, with the parsed text after the edit.
    let hits = harness(&env, &["search", dir_s, "clausius"]);
    let hits: Vec<Value> = hits
        .as_array()
        .unwrap_or_else(|| panic!("no hits: {hits}"))
        .iter()
        .map(|h| json!([h["lecture"], h["block"], h["text"]]))
        .collect();
    assert_eq!(hits, vec![json!([LECTURE, "s1b2", format!("{TYPED}{FIRST}")])]);

    // Ask for a plot on that block: the assembled request, and the sample's figure answer to it.
    let lecture = dir.join(LECTURE);
    let req = harness(&env, &["prompt", lecture.to_str().unwrap_or_default(), "s1b2", "Can", "you", "plot", "this?"]);
    let content = req["messages"][0]["content"].as_str().unwrap_or_default();
    assert_eq!(
        content,
        format!(
            "<untrusted_source block=\"s1b2\">\nEntropy and heat › Entropy and heat\n{TYPED}{FIRST}\n</untrusted_source>\n\nCan you plot this?"
        )
    );
    let request = ChatRequest {
        model: req["model"].as_str().unwrap_or_default().into(),
        system: req["system"].as_str().unwrap_or_default().into(),
        messages: vec![Message { role: Role::User, content: content.into() }],
        max_output_tokens: 1024,
    };
    assert_eq!(request.model, "sample");
    let answer = answer_for(&request);
    assert_eq!(answer, SAMPLE_PLOT_ANSWER);
    assert!(answer.contains("\n```fnplot\n{\"type\": \"fnplot\", \"exprs\": [\"x^2\"]"), "{answer}");
}
