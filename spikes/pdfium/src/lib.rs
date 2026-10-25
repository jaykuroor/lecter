//! F-006 spike: get the pinned PDFium build (D-084) through `fetch_pdfium.py`, which checks its
//! SHA-256 before use (SEC-51), load it dynamically through `pdfium-render`, and read page text.
//!
//! Every error carries the paths and the loader's own message, so a CI failure on macOS or Windows
//! explains itself without a rerun.
#![allow(
    clippy::disallowed_methods,
    reason = "synchronous spike; no async runtime, so std::fs and std::process are fine"
)]

use std::fmt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use pdfium_render::prelude::{PdfDocument, Pdfium};

/// What went wrong, with enough context to act on it.
#[derive(Debug)]
pub struct SpikeError(pub String);

impl fmt::Display for SpikeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for SpikeError {}

/// The spike folder (holds `fetch_pdfium.py` and `pins.json`).
pub fn spike_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// Where the verified archives and libraries are cached: `<workspace>/target/pdfium` (git-ignored).
pub fn default_cache_dir() -> PathBuf {
    spike_dir().join("..").join("..").join("target").join("pdfium")
}

/// Runs `fetch_pdfium.py` with `args` under the first Python launcher that starts.
pub fn run_fetch_script(args: &[&str]) -> Result<Output, SpikeError> {
    let script = spike_dir().join("fetch_pdfium.py");
    let mut tried = Vec::new();
    // On Windows `python3` can be the Microsoft Store stub, so try the real launchers first.
    let candidates: &[&str] = if cfg!(windows) { &["python", "py", "python3"] } else { &["python3", "python"] };
    for &python in candidates {
        match Command::new(python).arg("-I").arg(&script).args(args).output() {
            Ok(out) => return Ok(out),
            Err(e) => tried.push(format!("{python}: {e}")),
        }
    }
    Err(SpikeError(format!("could not start Python to run {}: {}", script.display(), tried.join("; "))))
}

/// Downloads (or reuses) the host's pinned PDFium in `cache`, verified against `pins.json`, and
/// returns the library path the script printed.
pub fn fetch_host_library(cache: &Path) -> Result<PathBuf, SpikeError> {
    let dest = cache.to_string_lossy().into_owned();
    let out = run_fetch_script(&["--dest", &dest])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !out.status.success() {
        return Err(SpikeError(format!(
            "fetch_pdfium.py failed ({}) for cache {dest}:\nstdout: {stdout}\nstderr: {stderr}",
            out.status
        )));
    }
    let lib = PathBuf::from(stdout.trim());
    if !lib.is_file() {
        return Err(SpikeError(format!(
            "fetch_pdfium.py reported {} but no such file exists (stderr: {stderr})",
            lib.display()
        )));
    }
    Ok(lib)
}

/// Binds `pdfium-render` to the library at `lib`. Only one binding per process is possible.
pub fn bind(lib: &Path) -> Result<Pdfium, SpikeError> {
    let bindings = Pdfium::bind_to_library(lib).map_err(|e| {
        SpikeError(format!(
            "pdfium-render could not load {} ({} bytes on disk): {e:?}",
            lib.display(),
            std::fs::metadata(lib).map(|m| m.len()).unwrap_or(0)
        ))
    })?;
    Ok(Pdfium::new(bindings))
}

/// All text on page 1 of the PDF in `bytes`.
pub fn page_one_text(pdfium: &Pdfium, bytes: &[u8]) -> Result<String, SpikeError> {
    let doc: PdfDocument<'_> = pdfium
        .load_pdf_from_byte_slice(bytes, None)
        .map_err(|e| SpikeError(format!("PDFium could not open the fixture PDF: {e:?}")))?;
    let page = doc.pages().get(0).map_err(|e| SpikeError(format!("PDFium could not load page 1: {e:?}")))?;
    let text = page.text().map_err(|e| SpikeError(format!("PDFium could not read page 1 text: {e:?}")))?;
    Ok(text.all())
}

/// A one-page PDF with one line of `text` in Helvetica (a standard font, so nothing is embedded).
/// `text` must be printable ASCII without parentheses or backslashes.
pub fn synthetic_pdf(text: &str) -> Vec<u8> {
    let content = format!("BT /F1 24 Tf 72 720 Td ({text}) Tj ET");
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_owned(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>".to_owned(),
        format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_owned(),
    ];
    let mut pdf = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (i, body) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.extend_from_slice(format!("{} 0 obj\n{body}\nendobj\n", i + 1).as_bytes());
    }
    let xref = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes());
    for off in offsets {
        pdf.extend_from_slice(format!("{off:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(
        format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1).as_bytes(),
    );
    pdf
}
