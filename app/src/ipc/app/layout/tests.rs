#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use lecter_core::testenv::TestEnv;

use super::super::super::error::ErrorCode;
use super::*;

fn run<T>(f: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(f)
}

/// The contract (18-contracts.md#ipc, area `app`): what the UI may send each command.
#[test]
fn the_layout_commands_take_only_what_they_name() {
    let contract = super::super::super::contract();
    let args = |name| crate::export::command_args(&contract, name);
    assert_eq!(args("app_layout_get"), Some(vec![]));
    assert_eq!(args("app_layout_save"), Some(vec!["layout".to_owned()]));
}

// D-195: toggle the sidebar off, start again (a new store on the same state.db), still off.
#[test]
fn a_saved_layout_is_what_the_next_start_reads() {
    let env = TestEnv::new().unwrap();
    assert_eq!(run(get(&LayoutStore::new(&env.dirs()))).unwrap(), Layout { sidebar: true });
    run(save(&LayoutStore::new(&env.dirs()), Layout { sidebar: false })).unwrap();
    assert_eq!(run(get(&LayoutStore::new(&env.dirs()))).unwrap(), Layout { sidebar: false });
}

#[test]
fn a_broken_state_db_is_an_io_error_with_a_plain_message() {
    let env = TestEnv::new().unwrap();
    let db = env.dirs().data().join(lecter_core::identity::STATE_DB);
    std::fs::create_dir_all(db.parent().unwrap()).unwrap();
    std::fs::write(&db, "this is not SQLite, just text long enough to fill a header page").unwrap();
    let store = LayoutStore::at(db);
    let e = run(get(&store)).unwrap_err();
    assert_eq!((e.code, e.message.as_str()), (ErrorCode::Io, "Lecter could not remember the window's layout."));
    let e = run(save(&store, Layout { sidebar: false })).unwrap_err();
    assert_eq!(e.code, ErrorCode::Io);
}
