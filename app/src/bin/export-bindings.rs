//! Writes `ui/src/core/bindings.ts` from the IPC contract in `app/src/ipc/` (18-contracts.md#ipc).
//!
//!   cargo run -p lecter-app --bin export-bindings              # regenerate the file
//!   cargo run -p lecter-app --bin export-bindings -- --check   # exit 1 if it is stale
//!
//! `--bindings <path>` writes or checks another file instead (app/tests/export_bindings.rs). Exit
//! status: 0 done or current, 1 stale or failed, 2 usage error.
//!
//! The shell's modules are compiled in from `src/` as they are, so the contract has one source.

// Only the contract is used here; the rest of those modules serves the running shell.
#![allow(dead_code, reason = "the shell's modules are compiled in whole; this tool uses only the contract")]

#[path = "../dialog.rs"]
mod dialog;
#[path = "../ipc/export.rs"]
mod export;
#[path = "../ipc/mod.rs"]
mod ipc;
#[cfg(any(debug_assertions, feature = "test-hooks"))]
#[path = "../test_hooks.rs"]
mod test_hooks;

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use export::BINDINGS;

#[allow(clippy::disallowed_methods, reason = "a one-shot build tool with no async runtime")]
fn main() -> ExitCode {
    let Some(Args { check, path }) = parse(std::env::args().skip(1)) else {
        eprintln!("usage: export-bindings [--check] [--bindings <path>]");
        return ExitCode::from(2);
    };
    let shown = path.display();
    let rendered = match export::render(&ipc::contract()) {
        Ok(text) => text,
        Err(e) => {
            eprintln!("export-bindings: {e}");
            return ExitCode::FAILURE;
        }
    };
    if check {
        let committed = std::fs::read_to_string(&path).unwrap_or_default();
        if export::is_current(&committed, &rendered) {
            return ExitCode::SUCCESS;
        }
        eprintln!("{shown} is stale: run `cargo run -p lecter-app --bin export-bindings` and commit {BINDINGS}");
        return ExitCode::FAILURE;
    }
    if let Err(e) = std::fs::write(&path, rendered) {
        eprintln!("export-bindings: {shown}: {e}");
        return ExitCode::FAILURE;
    }
    println!("wrote {shown}");
    ExitCode::SUCCESS
}

struct Args {
    check: bool,
    path: PathBuf,
}

/// `[--check] [--bindings <path>]` in any order, each at most once; anything else is `None`.
fn parse(args: impl Iterator<Item = String>) -> Option<Args> {
    let (mut check, mut path) = (false, None);
    let mut args = args;
    while let Some(a) = args.next() {
        match a.as_str() {
            "--check" if !check => check = true,
            "--bindings" if path.is_none() => path = Some(PathBuf::from(args.next()?)),
            _ => return None,
        }
    }
    let path = path.unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(BINDINGS));
    Some(Args { check, path })
}
