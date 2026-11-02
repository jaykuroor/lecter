//! F-019 criterion 4: `lecter-harness parse <pdf>` prints the blocks as JSON, parsed by the worker
//! in a child process through the core. The worker reads the verified PDFium under
//! `target/pdfium/` (scripts/init.sh); nothing here downloads.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde_json::{Value, json};

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/pdf/text-two-pages.pdf")
}

fn harness(args: &[&str], envs: &[(&str, &str)]) -> Output {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_lecter-harness"));
    cmd.args(args).env_remove("LECTER_PDFIUM_DIR");
    for (k, v) in envs {
        cmd.env(k, v);
    }
    cmd.output().unwrap_or_else(|e| panic!("run lecter-harness: {e}"))
}

fn one_json(out: &Output) -> Value {
    let text = std::str::from_utf8(&out.stdout).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(text.lines().count(), 1, "{text:?} / stderr {}", String::from_utf8_lossy(&out.stderr));
    serde_json::from_str(text.trim_end()).unwrap_or_else(|e| panic!("not JSON ({e}): {text:?}"))
}

#[test]
fn parse_prints_the_fixture_blocks_as_json() {
    let file = fixture();
    let out = harness(&["parse", file.to_str().unwrap_or_default(), "--json"], &[]);
    let v = one_json(&out);
    assert_eq!(out.status.code(), Some(0), "{v}");
    let blocks = v["blocks"].as_array().unwrap_or_else(|| panic!("no blocks: {v}"));
    let got: Vec<Value> = blocks
        .iter()
        .map(|b| json!([b["id"], b["page"], b["text"], b["kind"], b["method"], b["confidence"]]))
        .collect();
    let want = [
        json!(["s1b1", 1, "Entropy and heat", "paragraph", "text_layer", 1.0]),
        json!([
            "s1b2",
            1,
            "The second law says that the entropy\nof an isolated system never falls.",
            "paragraph",
            "text_layer",
            1.0
        ]),
        json!(["s1b3", 1, "Heat flows from hot to cold.", "paragraph", "text_layer", 1.0]),
        json!(["s2b1", 2, "Worked example", "paragraph", "text_layer", 1.0]),
        json!([
            "s2b2",
            2,
            "A cup of tea cools in a room.\nIts entropy falls and the room gains more.",
            "paragraph",
            "text_layer",
            1.0
        ]),
    ];
    assert_eq!(got, want);
    for b in blocks {
        for k in ["x", "y", "w", "h"] {
            assert!(b["bbox"][k].as_f64().is_some_and(|n| (0.0..=612.0).contains(&n)), "{b}");
        }
    }
    assert_eq!(v["crops"], json!([]));
    assert_eq!(v["figures"], json!([]));
    assert!(v["path"].as_str().is_some_and(|p| p.ends_with("text-two-pages.pdf")), "{v}");
}

#[test]
fn parse_text_output_lists_blocks_by_page() {
    let file = fixture();
    let out = harness(&["parse", file.to_str().unwrap_or_default()], &[]);
    let text = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(0), "{}", String::from_utf8_lossy(&out.stderr));
    assert!(text.starts_with("5 blocks\ns1b1 p1: Entropy and heat\n"), "{text}");
    assert!(text.contains("\ns2b2 p2: A cup of tea cools in a room.\n    Its entropy"), "{text}");
}

#[test]
fn parse_without_pdfium_is_parse_failed() {
    let empty = std::env::temp_dir().join(format!("lecter-harness-no-pdfium-{}", std::process::id()));
    let file = fixture();
    let out = harness(
        &["parse", file.to_str().unwrap_or_default(), "--json"],
        &[("LECTER_PDFIUM_DIR", empty.to_str().unwrap_or_default())],
    );
    let v = one_json(&out);
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(v["error"]["code"], "E_PARSE_FAILED");
    assert!(v["error"]["message"].as_str().is_some_and(|m| m.contains("PDFium is missing")), "{v}");
}

#[test]
fn parse_of_a_missing_file_is_not_found() {
    let out = harness(&["parse", "/no/such/deck.pdf", "--json"], &[]);
    let v = one_json(&out);
    assert_eq!(v["error"]["code"], "E_NOT_FOUND");
}
