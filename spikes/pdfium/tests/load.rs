//! Criterion 2: PDFium loads dynamically through pdfium-render and returns page-1 text from a
//! synthetic PDF, on every CI OS. One binding per process, so this file holds one test.

use lecter_spike_pdfium::{bind, default_cache_dir, fetch_host_library, page_one_text, synthetic_pdf};

const LINE: &str = "Synthetic lecture slide one: entropy and heat";

#[test]
fn pdfium_loads_dynamically_and_extracts_page_one_text() {
    let lib = fetch_host_library(&default_cache_dir()).unwrap_or_else(|e| panic!("{e}"));
    println!("loading {}", lib.display());
    let pdfium = bind(&lib).unwrap_or_else(|e| panic!("{e}"));
    let text = page_one_text(&pdfium, &synthetic_pdf(LINE)).unwrap_or_else(|e| panic!("{e}"));
    println!("page 1 text: {text:?}");
    assert_eq!(text.trim(), LINE, "page 1 text from {}", lib.display());
}
