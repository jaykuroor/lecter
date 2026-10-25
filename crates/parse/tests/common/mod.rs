//! Shared by the tests that load PDFium: where the verified library and the fixtures are.

#![allow(dead_code, reason = "each test file uses a different part")]

use std::path::{Path, PathBuf};

use lecter_parse::pdfium::{HOST_TARGET, LIBRARY_FILE, TAG_DIR};

/// The folder holding the pinned, SHA-256-verified PDFium that `scripts/init.sh` placed under
/// `target/pdfium/` (D-108). `LECTER_PDFIUM_DIR` overrides it. The search walks up from this crate,
/// so a copy of the tree inside the checkout (cargo-mutants under `.verify/`) still finds it.
/// Tests never download: a missing library fails with the command that fetches it.
pub fn pdfium_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("LECTER_PDFIUM_DIR") {
        return PathBuf::from(dir);
    }
    let start = Path::new(env!("CARGO_MANIFEST_DIR"));
    start
        .ancestors()
        .map(|a| a.join("target").join("pdfium").join(TAG_DIR).join(HOST_TARGET))
        .find(|d| d.join(LIBRARY_FILE).is_file())
        .unwrap_or_else(|| {
            panic!(
                "no verified PDFium under target/pdfium/{TAG_DIR}/{HOST_TARGET} above {}: run scripts/init.sh \
                 (or python3 spikes/pdfium/fetch_pdfium.py)",
                start.display()
            )
        })
}

/// A fixture under `tests/fixtures/pdf/`.
pub fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/pdf").join(name)
}

/// The blocks of `text-two-pages.pdf`, from its generator's design (make_fixtures.py), as
/// (id, page, text) in reading order.
pub const TWO_PAGES: [(&str, u32, &str); 5] = [
    ("s1b1", 1, "Entropy and heat"),
    ("s1b2", 1, "The second law says that the entropy\nof an isolated system never falls."),
    ("s1b3", 1, "Heat flows from hot to cold."),
    ("s2b1", 2, "Worked example"),
    ("s2b2", 2, "A cup of tea cools in a room.\nIts entropy falls and the room gains more."),
];
