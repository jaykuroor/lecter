//! The worker protocol between the core and `lecter-parse` (`18-contracts.md#worker-protocol`).
//!
//! Each frame is a 4-byte little-endian body length, then the body: `postcard` in release builds,
//! JSON in debug builds ([`Codec::BUILD`]). The first frame each way is `Hello { proto_version }`;
//! then the core sends one `Parse`, and the worker answers `Progress`* then `Done` or `Failed`.

use std::io::{Read, Write};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

/// Bumped on every change to a message below; both ends refuse a peer with another value.
pub const PROTO_VERSION: u32 = 1;

/// The largest frame body either end accepts or sends. A `Done` bigger than this is refused by the
/// worker (as a limit), so a hostile file can't make the core buffer gigabytes.
pub const MAX_FRAME_BYTES: usize = 128 * 1024 * 1024;

/// The worker's one command-line flag: `lecter-parse --pdfium-dir <absolute folder>`, the folder
/// holding the PDFium library it loads (never one from the system search path).
pub const PDFIUM_DIR_FLAG: &str = "--pdfium-dir";

/// Core → worker.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ToWorker {
    /// The first frame: the core's protocol version.
    Hello {
        /// [`PROTO_VERSION`] of the sender.
        proto_version: u32,
    },
    /// Parse the one file at `path` (absolute) within `limits`.
    Parse {
        /// The file to read, as an absolute path.
        path: String,
        /// The SEC-04 limits for this file.
        limits: Limits,
    },
}

/// Worker → core.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum FromWorker {
    /// The first frame: the worker's protocol version.
    Hello {
        /// [`PROTO_VERSION`] of the sender.
        proto_version: u32,
    },
    /// Page `page` of `pages` is read (1-based).
    Progress {
        /// The page just finished, 1-based.
        page: u32,
        /// Pages in the file.
        pages: u32,
    },
    /// The file is parsed.
    Done {
        /// Every block, in reading order.
        blocks: Vec<Block>,
        /// Image crops of regions the text layer can't read (none for a text-layer page).
        crops: Vec<Crop>,
        /// Figures found on the pages (none for a text-layer page).
        figures: Vec<Figure>,
    },
    /// The file could not be parsed.
    Failed {
        /// What kind of failure.
        code: FailCode,
        /// A sentence for the person, naming the limit or the problem (never the file's text).
        reason: String,
    },
}

/// Why a parse failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FailCode {
    /// The file could not be opened or read.
    Io,
    /// The file is not a document the worker can read (damaged, encrypted, another format).
    Unreadable,
    /// The file is over one of the [`Limits`].
    Limit,
    /// The worker's own setup failed (PDFium missing or not loadable).
    Engine,
}

/// The size limits of `13-security.md#untrusted-files` (SEC-04), sent with every file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Limits {
    /// Largest file, in bytes.
    pub file_bytes: u64,
    /// Most pages.
    pub pages: u32,
    /// Largest decoded image, in megapixels.
    pub image_megapixels: u32,
    /// Deepest PDF object nesting.
    pub pdf_object_depth: u32,
    /// Most text extracted from one page, in bytes.
    pub page_text_bytes: u64,
}

impl Default for Limits {
    /// SEC-04's defaults: 500 MB, 2,000 pages, 100 megapixels, depth 64, 1 MB of text per page.
    fn default() -> Self {
        Self {
            file_bytes: 500 * 1000 * 1000,
            pages: 2000,
            image_megapixels: 100,
            pdf_object_depth: 64,
            page_text_bytes: 1000 * 1000,
        }
    }
}

/// One paragraph, heading, list item, equation, table or figure of a slide.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Block {
    /// Stable short id: `s<slide>b<n>`, `n` counting from 1 in reading order on the slide.
    pub id: String,
    /// The page it came from, 1-based.
    pub page: u32,
    /// What kind of block.
    pub kind: BlockKind,
    /// Its text as Markdown (lines joined with `\n`).
    pub text: String,
    /// Where it sits on the page.
    pub bbox: BBox,
    /// The reading-ladder step that produced it (`04-parsing.md#reading-ladder`).
    pub method: Method,
    /// 0..=1; the text layer reads with full confidence.
    pub confidence: f32,
}

/// The kind of a [`Block`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockKind {
    /// Running text.
    Paragraph,
}

/// The reading-ladder step that produced a block.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Method {
    /// Step 2: the PDF text layer.
    TextLayer,
}

/// A rectangle on a page in PDF points (1/72 in), origin at the page's top-left corner, y down.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct BBox {
    /// Left edge.
    pub x: f32,
    /// Top edge.
    pub y: f32,
    /// Width.
    pub w: f32,
    /// Height.
    pub h: f32,
}

/// An image crop of a page region, for vision or display.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Crop {
    /// The page, 1-based.
    pub page: u32,
    /// The region.
    pub bbox: BBox,
}

/// A figure on a page, the input of its figure card.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Figure {
    /// The page, 1-based.
    pub page: u32,
    /// The region.
    pub bbox: BBox,
}

/// A frame that could not be written or read.
#[derive(Debug, thiserror::Error)]
pub enum FrameError {
    /// The pipe failed.
    #[error("worker pipe: {0}")]
    Io(#[from] std::io::Error),
    /// The pipe closed in the middle of a frame.
    #[error("the pipe closed in the middle of a frame")]
    Truncated,
    /// A length prefix over [`MAX_FRAME_BYTES`].
    #[error("a {0}-byte frame is over the {MAX_FRAME_BYTES}-byte limit")]
    TooLarge(usize),
    /// The body is not a message of the expected type.
    #[error("malformed frame: {0}")]
    Malformed(String),
}

/// How frame bodies are encoded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Codec {
    /// `serde_json` (debug builds: readable in a pipe dump).
    Json,
    /// `postcard` (release builds: compact and fast).
    Postcard,
}

impl Codec {
    /// The codec both ends of this build use: JSON in debug builds, `postcard` in release.
    pub const BUILD: Self = if cfg!(debug_assertions) { Self::Json } else { Self::Postcard };

    /// `msg` as one frame: length prefix and body.
    pub fn encode<T: Serialize>(self, msg: &T) -> Result<Vec<u8>, FrameError> {
        let body = match self {
            Self::Json => serde_json::to_vec(msg).map_err(|e| FrameError::Malformed(e.to_string()))?,
            Self::Postcard => postcard::to_allocvec(msg).map_err(|e| FrameError::Malformed(e.to_string()))?,
        };
        let len = u32::try_from(body.len())
            .ok()
            .filter(|_| body.len() <= MAX_FRAME_BYTES)
            .ok_or(FrameError::TooLarge(body.len()))?;
        let mut frame = Vec::with_capacity(4 + body.len());
        frame.extend_from_slice(&len.to_le_bytes());
        frame.extend_from_slice(&body);
        Ok(frame)
    }

    /// A frame body (without its length prefix) as a `T`.
    pub fn decode<T: DeserializeOwned>(self, body: &[u8]) -> Result<T, FrameError> {
        match self {
            Self::Json => serde_json::from_slice(body).map_err(|e| FrameError::Malformed(e.to_string())),
            Self::Postcard => postcard::from_bytes(body).map_err(|e| FrameError::Malformed(e.to_string())),
        }
    }
}

/// The body length a 4-byte prefix announces, refusing anything over [`MAX_FRAME_BYTES`].
pub fn body_len(prefix: [u8; 4]) -> Result<usize, FrameError> {
    let len = u32::from_le_bytes(prefix) as usize;
    if len > MAX_FRAME_BYTES { Err(FrameError::TooLarge(len)) } else { Ok(len) }
}

/// Writes `msg` as one frame and flushes.
pub fn write_frame<W: Write, T: Serialize>(w: &mut W, codec: Codec, msg: &T) -> Result<(), FrameError> {
    w.write_all(&codec.encode(msg)?)?;
    w.flush()?;
    Ok(())
}

/// Reads one frame. `Ok(None)` when the pipe closed cleanly before the frame began.
pub fn read_frame<R: Read, T: DeserializeOwned>(r: &mut R, codec: Codec) -> Result<Option<T>, FrameError> {
    let mut prefix = [0u8; 4];
    let mut got = 0;
    while got < prefix.len() {
        match r.read(&mut prefix[got..])? {
            0 if got == 0 => return Ok(None),
            0 => return Err(FrameError::Truncated),
            n => got += n,
        }
    }
    let mut body = vec![0u8; body_len(prefix)?];
    r.read_exact(&mut body).map_err(|e| match e.kind() {
        std::io::ErrorKind::UnexpectedEof => FrameError::Truncated,
        _ => FrameError::Io(e),
    })?;
    codec.decode(&body).map(Some)
}

#[cfg(test)]
#[path = "proto_tests.rs"]
mod tests;
