#![allow(clippy::disallowed_methods, reason = "tests build fixture files on plain test threads")]

use lecter_core::keymaps::{KEYMAPS_FILE, MAX_KEYMAPS_BYTES};
use lecter_core::testenv::TestEnv;

use super::super::error::ErrorCode;
use super::*;

fn run<T>(f: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(f)
}

/// The contract (18-contracts.md#ipc, area `keymaps`): the UI sends nothing.
#[test]
fn keymaps_read_takes_no_arguments() {
    let contract = super::super::contract();
    assert_eq!(crate::export::command_args(&contract, "keymaps_read"), Some(vec![]));
}

#[test]
fn reads_the_global_file_or_nothing() {
    let env = TestEnv::new().unwrap();
    let file = KeymapsFile::new(&env.dirs());
    assert_eq!(run(read(&file)).unwrap(), None);
    std::fs::create_dir_all(env.dirs().config()).unwrap();
    std::fs::write(env.dirs().config().join(KEYMAPS_FILE), "{\"version\": 1, \"bindings\": []}").unwrap();
    assert_eq!(run(read(&file)).unwrap().as_deref(), Some("{\"version\": 1, \"bindings\": []}"));
}

#[test]
fn an_oversize_or_unreadable_file_is_a_typed_error() {
    let env = TestEnv::new().unwrap();
    let path = env.dirs().config().join(KEYMAPS_FILE);
    std::fs::create_dir_all(env.dirs().config()).unwrap();
    std::fs::write(&path, vec![b' '; usize::try_from(MAX_KEYMAPS_BYTES).unwrap() + 1]).unwrap();
    let e = run(read(&KeymapsFile::at(path.clone()))).unwrap_err();
    assert_eq!(
        (e.code, e.message.as_str()),
        (ErrorCode::InvalidArgument, "keymaps.jsonc is larger than 256 KB; the default keys are used.")
    );
    std::fs::remove_file(&path).unwrap();
    std::fs::create_dir_all(&path).unwrap();
    let e = run(read(&KeymapsFile::at(path))).unwrap_err();
    assert_eq!(e.code, ErrorCode::Io);
}
