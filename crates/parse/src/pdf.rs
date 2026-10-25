//! Reading a PDF's text layer through PDFium (`04-parsing.md#reading-ladder`, step 2).

use std::path::Path;

use pdfium_render::prelude::{PdfDocument, PdfPage, Pdfium, PdfiumError};

use crate::error::{Error, Result};
use crate::layout::{self, Run};
use crate::proto::{Block, Limits};

/// Reads the PDF at `path` into blocks, page by page, calling `progress(page, pages)` after each
/// page (1-based). Fails before reading on a file or page count over `limits`.
pub fn read(pdfium: &Pdfium, path: &Path, limits: &Limits, mut progress: impl FnMut(u32, u32)) -> Result<Vec<Block>> {
    let meta = std::fs::metadata(path).map_err(|e| Error::Io(format!("the file can't be read: {e}")))?;
    if !meta.is_file() {
        return Err(Error::Io("the path is not a file".into()));
    }
    if meta.len() > limits.file_bytes {
        return Err(Error::Limit(format!(
            "the file is {} bytes, over the {}-byte limit (limits.file_bytes)",
            meta.len(),
            limits.file_bytes
        )));
    }
    let doc = pdfium.load_pdf_from_file(path, None).map_err(open_error)?;
    let pages = page_count(&doc, limits)?;
    let mut blocks = Vec::new();
    for i in 0..pages {
        let page_no = i + 1;
        let index = i32::try_from(i).map_err(|_| Error::Limit("too many pages".into()))?;
        let page = doc.pages().get(index).map_err(|e| unreadable(page_no, &e))?;
        let (height, runs) = runs(&page, page_no, limits)?;
        blocks.extend(layout::blocks(page_no, height, runs));
        progress(page_no, pages);
    }
    Ok(blocks)
}

/// The document's page count, refused over `limits.pages`.
fn page_count(doc: &PdfDocument<'_>, limits: &Limits) -> Result<u32> {
    let pages = u32::try_from(doc.pages().len()).unwrap_or(0);
    if pages > limits.pages {
        return Err(Error::Limit(format!(
            "the file has {pages} pages, over the {}-page limit (limits.pages)",
            limits.pages
        )));
    }
    Ok(pages)
}

/// The page's height and its text runs, refused over `limits.page_text_bytes`.
fn runs(page: &PdfPage<'_>, page_no: u32, limits: &Limits) -> Result<(f32, Vec<Run>)> {
    let text = page.text().map_err(|e| unreadable(page_no, &e))?;
    let mut runs = Vec::new();
    let mut bytes = 0u64;
    for seg in text.segments().iter() {
        let s = seg.text();
        bytes += s.len() as u64;
        if bytes > limits.page_text_bytes {
            return Err(Error::Limit(format!(
                "page {page_no} has more than {} bytes of text (limits.page_text_bytes)",
                limits.page_text_bytes
            )));
        }
        let r = seg.bounds();
        runs.push(Run {
            text: s,
            left: r.left().value,
            bottom: r.bottom().value,
            right: r.right().value,
            top: r.top().value,
        });
    }
    Ok((page.height().value, runs))
}

fn open_error(e: PdfiumError) -> Error {
    match e {
        PdfiumError::IoError(io) => Error::Io(format!("the file can't be read: {io}")),
        other => Error::Unreadable(format!("PDFium can't open the file as a PDF: {other}")),
    }
}

fn unreadable(page: u32, e: &PdfiumError) -> Error {
    Error::Unreadable(format!("page {page} can't be read: {e}"))
}
