//! Renders the IPC contract to TypeScript (`ui/src/core/bindings.ts`, 18-contracts.md#ipc):
//! tauri-specta's types and `commands` wrappers, plus a `Commands` map (command name → args,
//! result, error) derived from those wrappers, which the mocked core implements. Used by the
//! `export-bindings` binary; `check` is its `--check` mode (verify.sh `bindings-stale`).

use std::cell::RefCell;
use std::fmt;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::atomic::{AtomicUsize, Ordering};

use specta_typescript::Typescript;
use tauri::Runtime;
use tauri_specta::{Builder, BuilderConfiguration, LanguageExt};

/// The bindings file, relative to the repository root.
pub const BINDINGS: &str = "ui/src/core/bindings.ts";

const HEADER: &str = "// Generated from app/src/ipc/ by `cargo run -p lecter-app --bin export-bindings`. Do not edit:\n\
// verify.sh (bindings-stale) fails when this file differs from the contract (18-contracts.md#ipc).";

/// Why the bindings couldn't be rendered or read.
#[derive(Debug)]
pub enum ExportError {
    /// tauri-specta or specta-typescript refused a type.
    Typescript(specta_typescript::Error),
    /// A file couldn't be written or read.
    Io(PathBuf, std::io::Error),
}

impl fmt::Display for ExportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Typescript(e) => write!(f, "TypeScript export failed: {e}"),
            Self::Io(p, e) => write!(f, "{}: {e}", p.display()),
        }
    }
}

impl std::error::Error for ExportError {}

/// The command names of a contract, as the UI invokes them (`app_info`).
pub fn command_names<R: Runtime>(contract: &Builder<R>) -> Vec<String> {
    commands(contract).into_iter().map(|(name, _)| name).collect()
}

/// Each command's name and argument names, in declaration order.
fn commands<R: Runtime>(contract: &Builder<R>) -> Vec<Signature> {
    let found = Rc::new(RefCell::new(Vec::new()));
    // `LanguageExt` is the only way tauri-specta hands out the collected functions; this
    // "language" just records them and writes nothing.
    let _ = contract.export(Collect(Rc::clone(&found)), Path::new(""));
    found.take()
}

/// A command's name and its argument names.
type Signature = (String, Vec<String>);

struct Collect(Rc<RefCell<Vec<Signature>>>);

impl LanguageExt for Collect {
    type Error = std::io::Error;

    fn export(self, cfg: &BuilderConfiguration, _path: &Path) -> Result<(), Self::Error> {
        let mut out = self.0.borrow_mut();
        for f in &cfg.commands {
            out.push((f.name().to_owned(), f.args().iter().map(|(n, _)| n.to_string()).collect()));
        }
        Ok(())
    }
}

/// The full text of `bindings.ts` for `contract`.
#[allow(clippy::disallowed_methods, reason = "runs in the export-bindings binary and tests, never on the runtime")]
pub fn render<R: Runtime>(contract: &Builder<R>) -> Result<String, ExportError> {
    // tauri-specta only exports to a file, so render into a fresh temporary folder, unique per
    // call. `create_dir` (not `_all`) fails if the folder exists, so nobody can plant a link there.
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("lecter-bindings-{}-{n}", std::process::id()));
    std::fs::create_dir(&dir).map_err(|e| ExportError::Io(dir.clone(), e))?;
    let tmp = dir.join("bindings.ts");
    let exported = contract.export(Typescript::default().header(HEADER), &tmp).map_err(ExportError::Typescript);
    let text = exported.and_then(|()| std::fs::read_to_string(&tmp).map_err(|e| ExportError::Io(tmp.clone(), e)));
    let _ = std::fs::remove_dir_all(&dir);
    let mut text = text?;
    text.push_str(&commands_map(&commands(contract)));
    Ok(text)
}

/// The `Commands` type: for every command, its arguments, result and error, read off the generated
/// `commands` wrapper, so the mocked core's handlers are checked against the real contract.
fn commands_map(commands: &[Signature]) -> String {
    let mut out = String::from(
        "\n/** Command name → its arguments, result and error, derived from `commands` (the mocked core implements it). */\n\
         export type Commands = {\n",
    );
    for (name, args) in commands {
        let method = camel(name);
        let fields: Vec<String> = args
            .iter()
            .enumerate()
            .map(|(i, a)| format!("{}: Parameters<typeof commands.{method}>[{i}]", camel(a)))
            .collect();
        let args =
            if fields.is_empty() { "Record<string, never>".to_owned() } else { format!("{{ {} }}", fields.join("; ")) };
        out.push_str(&format!(
            "  {name}: {{\n    args: {args};\n    result: CommandOk<Awaited<ReturnType<typeof commands.{method}>>>;\n    error: CommandError<Awaited<ReturnType<typeof commands.{method}>>>;\n  }};\n"
        ));
    }
    out.push_str(
        "};\n\n/** A command's name, as `invoke` takes it. */\nexport type CommandName = keyof Commands;\n\n\
         type CommandOk<R> = R extends { status: \"ok\"; data: infer T } ? T : R extends { status: \"error\" } ? never : R;\n\
         type CommandError<R> = R extends { status: \"error\"; error: infer E } ? E : never;\n",
    );
    out
}

/// `course_open` → `courseOpen`: how tauri-specta names the wrapper and Tauri the argument keys.
fn camel(snake: &str) -> String {
    let mut out = String::with_capacity(snake.len());
    let mut upper = false;
    for c in snake.chars() {
        if c == '_' {
            upper = !out.is_empty();
        } else if upper {
            out.extend(c.to_uppercase());
            upper = false;
        } else {
            out.push(c);
        }
    }
    out
}

/// Whether `committed` (the file's text) is what `rendered` would write; line endings are ignored
/// so a CRLF checkout on Windows isn't stale.
pub fn is_current(committed: &str, rendered: &str) -> bool {
    committed.replace("\r\n", "\n") == rendered.replace("\r\n", "\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::contract;

    #[allow(clippy::disallowed_methods, reason = "tests read the committed file on a plain test thread")]
    fn committed() -> String {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(BINDINGS);
        std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
    }

    fn rendered() -> String {
        render(&contract()).unwrap_or_else(|e| panic!("{e}"))
    }

    /// Criterion 1: the committed bindings are exactly what the contract in app/src/ipc/ renders.
    #[test]
    fn ipc_committed_bindings_match_the_contract() {
        assert!(
            is_current(&committed(), &rendered()),
            "{BINDINGS} is stale: run `cargo run -p lecter-app --bin export-bindings`"
        );
    }

    /// Criterion 2: a stale file is detected (what `--check` exits non-zero on).
    #[test]
    fn ipc_stale_bindings_are_detected() {
        let fresh = rendered();
        let stale = fresh.replace("courseOpen", "courseOpenOld");
        assert!(!is_current(&stale, &fresh));
        assert!(!is_current(&format!("{fresh}// edited by hand\n"), &fresh));
        assert!(is_current(&fresh.replace('\n', "\r\n"), &fresh), "a CRLF checkout is not stale");
    }

    #[test]
    fn ipc_bindings_declare_every_command_and_the_error_type() {
        let text = rendered();
        assert!(text.starts_with("// Generated from app/src/ipc/"), "header missing");
        for name in command_names(&contract()) {
            assert!(text.contains(&format!("\"{name}\"")), "invoke of {name} missing");
            assert!(text.contains(&format!("  {name}: {{")), "Commands entry for {name} missing");
        }
        assert!(text.contains("export type IpcError"), "IpcError type missing");
        assert!(text.contains("\"E_INVALID_ARGUMENT\""), "error codes missing");
        assert!(text.contains("\"E_INTERNAL\""), "error codes missing");
    }

    #[test]
    fn rendering_twice_is_identical() {
        assert_eq!(rendered(), rendered());
    }

    #[test]
    fn camel_case_matches_tauri() {
        assert_eq!(camel("course_open"), "courseOpen");
        assert_eq!(camel("app_info"), "appInfo");
        assert_eq!(camel("gloss_regenerate"), "glossRegenerate");
        assert_eq!(camel("query"), "query");
    }

    #[test]
    fn the_commands_map_reads_args_by_position() {
        let map = commands_map(&[("search_find".into(), vec!["query".into(), "max_hits".into()])]);
        assert!(map.contains(
            "search_find: {\n    args: { query: Parameters<typeof commands.searchFind>[0]; maxHits: Parameters<typeof commands.searchFind>[1] };"
        ));
        let none = commands_map(&[("app_info".into(), vec![])]);
        assert!(none.contains("args: Record<string, never>;"));
    }
}
