//! Writes `ui/src/core/bindings.ts` from the IPC contract in `app/src/ipc/` (18-contracts.md#ipc).
//!
//!   cargo run -p lecter-app --bin export-bindings              # regenerate the file
//!   cargo run -p lecter-app --bin export-bindings -- --check   # exit 1 if it is stale
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

use std::path::Path;
use std::process::ExitCode;

use export::BINDINGS;

#[allow(clippy::disallowed_methods, reason = "a one-shot build tool with no async runtime")]
fn main() -> ExitCode {
    let check = match std::env::args().skip(1).collect::<Vec<_>>().as_slice() {
        [] => false,
        [flag] if flag == "--check" => true,
        _ => {
            eprintln!("usage: export-bindings [--check]");
            return ExitCode::from(2);
        }
    };
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(BINDINGS);
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
        eprintln!("{BINDINGS} is stale: run `cargo run -p lecter-app --bin export-bindings` and commit it");
        return ExitCode::FAILURE;
    }
    if let Err(e) = std::fs::write(&path, rendered) {
        eprintln!("export-bindings: {}: {e}", path.display());
        return ExitCode::FAILURE;
    }
    println!("wrote {BINDINGS}");
    ExitCode::SUCCESS
}
