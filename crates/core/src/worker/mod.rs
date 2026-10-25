//! Worker processes (`01-architecture.md#processes`, `18-contracts.md#worker-protocol`).
//!
//! The core never reads an untrusted file itself: [`parse_file`] starts the `lecter-parse` worker,
//! checks its `Hello`, sends one `Parse`, relays `Progress` and returns the `Done` result. A worker
//! that crashes, breaks the protocol or runs past its time limit (60 s, SEC-01) is killed and the
//! file fails with `E_PARSE_FAILED`; the core itself only awaits pipes and a timer, so it stays
//! responsive whatever the worker does.

mod parse;

use std::ffi::OsString;
use std::path::PathBuf;
use std::time::Duration;

pub use lecter_parse::proto::{BBox, Block, BlockKind, Codec, Crop, Figure, Limits, Method};
use lecter_parse::proto::PDFIUM_DIR_FLAG;
pub use parse::{Parsed, parse_file};

/// SEC-01's time limit for one file.
pub const PARSE_TIMEOUT: Duration = Duration::from_secs(60);

/// How to start a worker process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkerCommand {
    /// The executable.
    pub program: PathBuf,
    /// Its arguments.
    pub args: Vec<OsString>,
    /// The frame codec it speaks: [`Codec::BUILD`] for a worker from the same build.
    pub codec: Codec,
}

impl WorkerCommand {
    /// The `lecter-parse` executable at `program`, loading PDFium from the absolute folder
    /// `pdfium_dir`.
    pub fn parse_worker(program: PathBuf, pdfium_dir: PathBuf) -> Self {
        Self { program, args: vec![PDFIUM_DIR_FLAG.into(), pdfium_dir.into_os_string()], codec: Codec::BUILD }
    }
}

#[cfg(test)]
mod tests;
