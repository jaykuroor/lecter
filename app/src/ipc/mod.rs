//! The IPC contract, declared once (`18-contracts.md#ipc`): commands live in one file per area
//! and are listed in `contract()`, which both the running shell and `export-bindings` (writing
//! `ui/src/core/bindings.ts`) use. `names.rs` repeats the names for `build.rs`'s permissions; a
//! test keeps it equal to `contract()`.

pub mod app;
pub mod course;
pub mod error;
pub mod guard;
#[cfg(test)]
mod names;
pub mod validate;

use tauri::Wry;
use tauri::ipc::Invoke;
use tauri_specta::{Builder, collect_commands, collect_events};

/// Every command and event the shell exposes, with their types.
pub fn contract() -> Builder<Wry> {
    Builder::<Wry>::new().commands(collect_commands![app::app_info, course::course_open]).events(collect_events![])
}

/// The invoke handler for `tauri::Builder::invoke_handler`: the contract's commands behind the
/// global argument limits (SEC-32).
pub fn invoke_handler(contract: &Builder<Wry>) -> impl Fn(Invoke<Wry>) -> bool + Send + Sync + 'static {
    guard::guarded(validate::IpcLimits::default(), contract.invoke_handler())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The command names the contract exports, as the UI invokes them.
    fn contract_names() -> Vec<String> {
        crate::export::command_names(&contract())
    }

    #[test]
    fn names_rs_lists_exactly_the_contract_commands() {
        let mut ours = contract_names();
        ours.sort();
        let mut listed: Vec<String> = names::COMMANDS.iter().map(|s| (*s).to_owned()).collect();
        listed.sort();
        assert_eq!(ours, listed, "names.rs (build.rs permissions) and contract() disagree");
    }

    /// 18-contracts.md#ipc: commands are `area_verb_object` in snake_case.
    #[test]
    fn command_names_are_snake_case() {
        for name in contract_names() {
            assert!(
                name.split('_').count() >= 2 && name.bytes().all(|b| b.is_ascii_lowercase() || b == b'_'),
                "{name}"
            );
        }
    }
}
