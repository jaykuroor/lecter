//! Criterion 2: a synthetic text-layer PDF becomes blocks with page numbers and reading order via
//! PDFium. PDFium binds once per process, so every test here shares one binding.

mod common;

use std::sync::OnceLock;

use common::{TWO_PAGES, fixture, pdfium_dir};
use lecter_parse::error::Error;
use lecter_parse::pdf;
use lecter_parse::proto::{BlockKind, Limits, Method};
use pdfium_render::prelude::Pdfium;

fn pdfium() -> &'static Pdfium {
    static PDFIUM: OnceLock<Pdfium> = OnceLock::new();
    PDFIUM.get_or_init(|| lecter_parse::pdfium::bind(&pdfium_dir()).unwrap_or_else(|e| panic!("{e}")))
}

#[test]
fn the_fixture_becomes_blocks_in_reading_order_with_pages() {
    let mut progress = Vec::new();
    let blocks = pdf::read(pdfium(), &fixture("text-two-pages.pdf"), &Limits::default(), |p, n| progress.push((p, n)))
        .unwrap_or_else(|e| panic!("{e}"));
    let got: Vec<(&str, u32, &str)> = blocks.iter().map(|b| (b.id.as_str(), b.page, b.text.as_str())).collect();
    assert_eq!(got, TWO_PAGES);
    assert_eq!(progress, [(1, 2), (2, 2)]);
    for b in &blocks {
        assert_eq!((b.kind, b.method, b.confidence), (BlockKind::Paragraph, Method::TextLayer, 1.0), "{}", b.id);
    }
}

#[test]
fn bboxes_sit_where_the_fixture_drew_the_text() {
    let blocks = pdf::read(pdfium(), &fixture("text-two-pages.pdf"), &Limits::default(), |_, _| {}).unwrap();
    // Title baseline at y = 720 of 792 (72 pt from the top), 28 pt Helvetica, starting at x = 72
    // (the box is the glyphs' own: the E's side bearing puts it a few points right of 72).
    let title = &blocks[0].bbox;
    assert!(title.x >= 72.0 && title.x < 76.0, "{title:?}");
    assert!(title.y > 40.0 && title.y < 72.0 && title.y + title.h > 72.0, "{title:?}");
    // Each later block on page 1 starts lower down.
    assert!(blocks[0].bbox.y < blocks[1].bbox.y && blocks[1].bbox.y < blocks[2].bbox.y);
}

#[test]
fn a_file_over_the_byte_limit_fails_before_pdfium_reads_it() {
    let path = fixture("text-two-pages.pdf");
    let len = std::fs::metadata(&path).unwrap().len();
    let at = Limits { file_bytes: len, ..Limits::default() };
    assert!(pdf::read(pdfium(), &path, &at, |_, _| {}).is_ok());
    let under = Limits { file_bytes: len - 1, ..Limits::default() };
    let e = pdf::read(pdfium(), &path, &under, |_, _| {}).unwrap_err();
    assert!(matches!(&e, Error::Limit(m) if m.contains("limits.file_bytes")), "{e:?}");
}

#[test]
fn a_file_over_the_page_limit_fails_before_any_page() {
    let path = fixture("text-two-pages.pdf");
    assert!(pdf::read(pdfium(), &path, &Limits { pages: 2, ..Limits::default() }, |_, _| {}).is_ok());
    let mut progress = 0;
    let e = pdf::read(pdfium(), &path, &Limits { pages: 1, ..Limits::default() }, |_, _| progress += 1).unwrap_err();
    assert!(matches!(&e, Error::Limit(m) if m.contains("2 pages") && m.contains("limits.pages")), "{e:?}");
    assert_eq!(progress, 0);
}

#[test]
fn a_page_with_more_text_than_the_limit_fails() {
    let path = fixture("text-two-pages.pdf");
    // Page 1 holds 114 bytes of text in four runs, none longer than 36.
    let e = pdf::read(pdfium(), &path, &Limits { page_text_bytes: 40, ..Limits::default() }, |_, _| {}).unwrap_err();
    assert!(matches!(&e, Error::Limit(m) if m.starts_with("page 1 ") && m.contains("limits.page_text_bytes")), "{e:?}");
}

#[test]
fn a_file_that_is_not_a_pdf_is_unreadable_and_a_missing_one_is_io() {
    let dir = std::env::temp_dir().join(format!("lecter-parse-pdf-text-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let junk = dir.join("junk.pdf");
    std::fs::write(&junk, b"this is not a PDF at all").unwrap();
    let e = pdf::read(pdfium(), &junk, &Limits::default(), |_, _| {}).unwrap_err();
    assert!(matches!(e, Error::Unreadable(_)), "{e:?}");
    let e = pdf::read(pdfium(), &dir.join("missing.pdf"), &Limits::default(), |_, _| {}).unwrap_err();
    assert!(matches!(e, Error::Io(_)), "{e:?}");
    let e = pdf::read(pdfium(), &dir, &Limits::default(), |_, _| {}).unwrap_err();
    assert!(matches!(&e, Error::Io(m) if m.contains("not a file")), "{e:?}");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn the_fixture_matches_its_generator() {
    let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/pdf/make_fixtures.py");
    let text = std::fs::read_to_string(script).unwrap();
    for (_, _, line) in TWO_PAGES {
        for part in line.split('\n') {
            assert!(text.contains(&format!("\"{part}\"")), "make_fixtures.py does not draw {part:?}");
        }
    }
}
