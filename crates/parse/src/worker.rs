//! The worker loop: one file per process (`18-contracts.md#worker-protocol`).
//!
//! `lecter-parse --pdfium-dir <absolute dir>` sends `Hello`, checks the core's `Hello`, reads one
//! `Parse`, answers `Progress`* then `Done` or `Failed`, and exits. A protocol mismatch ends the
//! process with a message on stderr and nothing parsed.

use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use crate::error::Error;
use crate::proto::{Codec, FrameError, FromWorker, Limits, PROTO_VERSION, ToWorker, read_frame, write_frame};
use crate::{pdf, pdfium};

/// The flag naming the folder that holds the PDFium library.
pub const PDFIUM_DIR_FLAG: &str = "--pdfium-dir";

/// Exit status for a bad command line.
pub const EXIT_USAGE: u8 = 2;
/// Exit status when the core broke the protocol (wrong version, unexpected or malformed frame).
pub const EXIT_PROTOCOL: u8 = 3;

/// Why the worker stopped without finishing the exchange.
#[derive(Debug, thiserror::Error)]
pub enum Stop {
    /// The core speaks another protocol version.
    #[error("protocol version mismatch: core {core}, worker {PROTO_VERSION}")]
    Version {
        /// The version the core sent.
        core: u32,
    },
    /// A frame other than the one expected next.
    #[error("expected {0} from the core")]
    Unexpected(&'static str),
    /// The pipe failed or carried a bad frame.
    #[error(transparent)]
    Frame(#[from] FrameError),
}

/// Runs one exchange over `input`/`output`, loading PDFium from `pdfium_dir` once a file arrives.
pub fn serve<R: Read, W: Write>(input: &mut R, output: &mut W, codec: Codec, pdfium_dir: &Path) -> Result<(), Stop> {
    write_frame(output, codec, &FromWorker::Hello { proto_version: PROTO_VERSION })?;
    match read_frame(input, codec)? {
        Some(ToWorker::Hello { proto_version }) if proto_version == PROTO_VERSION => {}
        Some(ToWorker::Hello { proto_version }) => return Err(Stop::Version { core: proto_version }),
        _ => return Err(Stop::Unexpected("Hello")),
    }
    let Some(ToWorker::Parse { path, limits }) = read_frame(input, codec)? else {
        return Err(Stop::Unexpected("Parse"));
    };
    let answer = match parse(Path::new(&path), &limits, pdfium_dir, |page, pages| {
        write_frame(output, codec, &FromWorker::Progress { page, pages })
    }) {
        Ok(Ok(blocks)) => FromWorker::Done { blocks, crops: Vec::new(), figures: Vec::new() },
        Ok(Err(e)) => FromWorker::Failed { code: e.code(), reason: e.to_string() },
        Err(frame) => return Err(Stop::Frame(frame)),
    };
    match codec.encode(&answer) {
        Ok(frame) => {
            output.write_all(&frame).map_err(FrameError::Io)?;
            output.flush().map_err(FrameError::Io)?;
        }
        Err(FrameError::TooLarge(n)) => write_frame(
            output,
            codec,
            &FromWorker::Failed {
                code: crate::proto::FailCode::Limit,
                reason: format!("the parsed result is {n} bytes, over the worker frame limit"),
            },
        )?,
        Err(e) => return Err(Stop::Frame(e)),
    }
    Ok(())
}

/// Parses one file. The outer error is a pipe failure while reporting progress.
fn parse<F>(
    path: &Path,
    limits: &Limits,
    pdfium_dir: &Path,
    mut progress: F,
) -> Result<crate::error::Result<Vec<crate::proto::Block>>, FrameError>
where
    F: FnMut(u32, u32) -> Result<(), FrameError>,
{
    if !path.is_absolute() {
        return Ok(Err(Error::Io("the file path must be absolute".into())));
    }
    let pdfium = match pdfium::bind(pdfium_dir) {
        Ok(p) => p,
        Err(e) => return Ok(Err(e)),
    };
    let mut pipe = Ok(());
    let result = pdf::read(&pdfium, path, limits, |page, pages| {
        if pipe.is_ok() {
            pipe = progress(page, pages);
        }
    });
    pipe.map(|()| result)
}

/// The `lecter-parse` process: `args` excludes the program name.
pub fn main<I: IntoIterator<Item = OsString>>(args: I) -> ExitCode {
    let mut args = args.into_iter();
    let dir = match (args.next(), args.next(), args.next()) {
        (Some(flag), Some(dir), None) if flag == PDFIUM_DIR_FLAG => PathBuf::from(dir),
        _ => {
            eprintln!("lecter-parse: usage: lecter-parse {PDFIUM_DIR_FLAG} <absolute folder holding PDFium>");
            return ExitCode::from(EXIT_USAGE);
        }
    };
    let mut input = std::io::stdin().lock();
    let mut output = std::io::stdout().lock();
    match serve(&mut input, &mut output, Codec::BUILD, &dir) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("lecter-parse: {e}");
            ExitCode::from(EXIT_PROTOCOL)
        }
    }
}

#[cfg(test)]
#[path = "worker_tests.rs"]
mod tests;
