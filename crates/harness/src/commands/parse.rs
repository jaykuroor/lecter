//! `lecter-harness parse <pdf>`: parses one file through the core's worker path and prints its
//! blocks (F-019).
//!
//! The core starts the worker as a child process and speaks the worker protocol with it, exactly
//! as the app will. The worker is this same executable run as `lecter-harness __parse-worker`,
//! which calls the `lecter_parse::worker::main` the `lecter-parse` binary runs, so the harness
//! needs no second binary built next to it. PDFium comes from `LECTER_PDFIUM_DIR`, or else the
//! verified download under `target/pdfium/` (`scripts/init.sh`) found above this executable.

use std::path::{Path, PathBuf};

use lecter_core::ErrorCode;
use lecter_core::worker::{self, Block, Limits, Parsed, WorkerCommand};
use lecter_parse::pdfium::{HOST_TARGET, LIBRARY_FILE, TAG_DIR};
use serde_json::json;

use super::{Command, Reply};
use crate::error::HarnessError;

/// The `parse` command.
pub const COMMAND: Command = Command { name: "parse", summary: "parse <pdf>: print a PDF's blocks", run };

/// The hidden first argument that makes this executable the parse worker.
pub const WORKER_ARG: &str = "__parse-worker";

/// Overrides the folder holding the PDFium library.
pub const PDFIUM_DIR_ENV: &str = "LECTER_PDFIUM_DIR";

const USAGE: &str = "usage: parse <pdf>";

fn run(args: &[String]) -> Result<Reply, HarnessError> {
    match args {
        [file] => parse(Path::new(file)),
        _ => Err(HarnessError::invalid_argument(format!("parse takes one file; {USAGE}"))),
    }
}

fn parse(file: &Path) -> Result<Reply, HarnessError> {
    let abs = std::path::absolute(file)
        .map_err(|_| HarnessError::invalid_argument("the file path can't be made absolute (no working directory?)"))?;
    if !abs.is_file() {
        return Err(HarnessError::new(ErrorCode::NotFound, format!("no such file: {}", abs.display())));
    }
    let exe = std::env::current_exe()
        .map_err(|e| HarnessError::new(ErrorCode::Internal, format!("can't find this executable: {e}")))?;
    let dir = pdfium_dir(std::env::var_os(PDFIUM_DIR_ENV), &exe)?;
    let mut cmd = WorkerCommand::parse_worker(exe, dir);
    cmd.args.insert(0, WORKER_ARG.into());
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| HarnessError::new(ErrorCode::Internal, format!("no async runtime: {e}")))?;
    let parsed = runtime
        .block_on(worker::parse_file(&cmd, &abs, Limits::default(), worker::PARSE_TIMEOUT, |_, _| {}))
        .map_err(|e| HarnessError::new(e.code(), e.to_string()))?;
    reply(&abs, &parsed)
}

/// `env` (`LECTER_PDFIUM_DIR`) if set, or the first `target/pdfium/<tag>/<host>` holding the
/// library above `exe`.
fn pdfium_dir(env: Option<std::ffi::OsString>, exe: &Path) -> Result<PathBuf, HarnessError> {
    if let Some(dir) = env {
        return Ok(PathBuf::from(dir));
    }
    exe.ancestors()
        .map(|a| a.join("target").join("pdfium").join(TAG_DIR).join(HOST_TARGET))
        .find(|d| d.join(LIBRARY_FILE).is_file())
        .ok_or_else(|| {
            HarnessError::new(
                ErrorCode::ParseFailed,
                format!(
                    "PDFium is missing: no target/pdfium/{TAG_DIR}/{HOST_TARGET}/{LIBRARY_FILE} above {}; run scripts/init.sh or set {PDFIUM_DIR_ENV}",
                    exe.display()
                ),
            )
        })
}

fn reply(file: &Path, parsed: &Parsed) -> Result<Reply, HarnessError> {
    let json = json!({
        "path": file.to_string_lossy(),
        "blocks": parsed.blocks,
        "crops": parsed.crops,
        "figures": parsed.figures,
    });
    Ok(Reply { text: text(&parsed.blocks), json })
}

/// One line per block (`s1b2 p1: …`), continuation lines indented.
fn text(blocks: &[Block]) -> String {
    let mut out = format!("{} blocks", blocks.len());
    for b in blocks {
        out.push_str(&format!("\n{} p{}: {}", b.id, b.page, b.text.replace('\n', "\n    ")));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use lecter_core::worker::{BBox, BlockKind, Method};

    fn call(args: &[&str]) -> Result<Reply, HarnessError> {
        run(&args.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>())
    }

    #[test]
    fn parse_takes_exactly_one_file() {
        for args in [&[][..], &["a.pdf", "b.pdf"][..]] {
            let e = call(args).err().unwrap_or_else(|| panic!("{args:?} was accepted"));
            assert_eq!(e.code, ErrorCode::InvalidArgument, "{args:?}");
            assert!(e.message.contains(USAGE), "{args:?}: {}", e.message);
        }
    }

    #[test]
    fn a_missing_file_is_not_found_before_any_worker_starts() {
        let e = call(&["/no/such/slides.pdf"]).unwrap_err();
        assert_eq!(e.code, ErrorCode::NotFound);
        assert!(e.message.contains("slides.pdf"), "{}", e.message);
    }

    #[test]
    fn text_lists_each_block_with_its_page() {
        let b = |id: &str, page, text: &str| Block {
            id: id.into(),
            page,
            kind: BlockKind::Paragraph,
            text: text.into(),
            bbox: BBox { x: 0.0, y: 0.0, w: 1.0, h: 1.0 },
            method: Method::TextLayer,
            confidence: 1.0,
        };
        let out = text(&[b("s1b1", 1, "Title"), b("s2b1", 2, "one\ntwo")]);
        assert_eq!(out, "2 blocks\ns1b1 p1: Title\ns2b1 p2: one\n    two");
    }

    #[test]
    fn pdfium_is_found_above_the_executable_or_reported_missing() {
        let root = std::env::temp_dir().join(format!("lecter-harness-pdfium-{}", std::process::id()));
        let lib_dir = root.join("target").join("pdfium").join(TAG_DIR).join(HOST_TARGET);
        let exe = root.join("target").join("debug").join("lecter-harness");
        let e = pdfium_dir(None, &exe).unwrap_err();
        assert_eq!(e.code, ErrorCode::ParseFailed);
        assert!(e.message.contains("PDFium is missing"), "{}", e.message);
        std::fs::create_dir_all(&lib_dir).unwrap();
        std::fs::write(lib_dir.join(LIBRARY_FILE), b"x").unwrap();
        let found = pdfium_dir(None, &exe);
        let overridden = pdfium_dir(Some("/opt/pdfium".into()), &exe);
        std::fs::remove_dir_all(&root).unwrap();
        assert_eq!(found.unwrap(), lib_dir);
        assert_eq!(overridden.unwrap(), Path::new("/opt/pdfium"));
    }
}
