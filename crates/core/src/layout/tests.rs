//! D-195: the sidebar's shown/hidden state survives restarts, in `<data>/state.db` beside the
//! course rail (D-188); the first start shows it.

#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::path::{Path, PathBuf};

use super::*;
use crate::ErrorCode;
use crate::course::known::KnownCourses;
use crate::testenv::TestEnv;

fn env() -> TestEnv {
    TestEnv::new().unwrap_or_else(|e| panic!("{e}"))
}

fn db(env: &TestEnv) -> PathBuf {
    env.home().join("data").join(STATE_DB)
}

fn ok<T>(r: Result<T>) -> T {
    r.unwrap_or_else(|e| panic!("{e:?}"))
}

/// The raw `layout` value in the state.db at `db`.
fn stored(db: &Path) -> Option<String> {
    let conn = rusqlite::Connection::open(db).unwrap_or_else(|e| panic!("{e}"));
    conn.query_row("SELECT value FROM meta WHERE key = 'layout'", [], |r| r.get(0)).ok()
}

/// Writes `value` as the raw `layout` value.
fn put(db: &Path, value: &str) {
    std::fs::create_dir_all(db.parent().unwrap_or(db)).unwrap_or_else(|e| panic!("{e}"));
    let conn = rusqlite::Connection::open(db).unwrap_or_else(|e| panic!("{e}"));
    conn.execute_batch("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
        .unwrap_or_else(|e| panic!("{e}"));
    conn.execute("INSERT OR REPLACE INTO meta VALUES ('layout', ?1)", [value]).unwrap_or_else(|e| panic!("{e}"));
}

#[test]
fn the_first_start_shows_the_sidebar_and_writes_nothing() {
    let env = env();
    let store = LayoutStore::at(db(&env));
    assert_eq!(ok(store.get()), Layout { sidebar: true });
    assert_eq!(stored(&db(&env)), None);
}

#[test]
fn a_hidden_sidebar_stays_hidden_after_a_restart() {
    let env = env();
    ok(LayoutStore::at(db(&env)).save(Layout { sidebar: false }));
    // A new store on the same file is the next start of the app.
    assert_eq!(ok(LayoutStore::at(db(&env)).get()), Layout { sidebar: false });
    assert_eq!(stored(&db(&env)).as_deref(), Some(r#"{"sidebar":false}"#));
    ok(LayoutStore::at(db(&env)).save(Layout { sidebar: true }));
    assert_eq!(ok(LayoutStore::at(db(&env)).get()), Layout { sidebar: true });
}

#[test]
fn the_layout_lives_in_the_data_folders_state_db_beside_the_rail() {
    let env = env();
    let dirs = env.dirs();
    ok(LayoutStore::new(&dirs).save(Layout { sidebar: false }));
    assert_eq!(stored(&dirs.data().join(STATE_DB)).as_deref(), Some(r#"{"sidebar":false}"#));
    // The rail's courses are another key of the same table: neither touches the other.
    let rail = KnownCourses::new(&dirs);
    assert_eq!(ok(rail.paths()), Vec::<String>::new());
    assert_eq!(ok(LayoutStore::new(&dirs).get()), Layout { sidebar: false });
}

#[test]
fn a_value_that_is_not_a_layout_reads_as_the_default() {
    let env = env();
    let store = LayoutStore::at(db(&env));
    for (value, sidebar) in [
        ("not json", true),
        ("[false]", true),
        ("false", true),
        ("{}", true),
        (r#"{"sidebar":"no"}"#, true),
        (r#"{"sidebar":0}"#, true),
        (r#"{"sidebar":null}"#, true),
        (r#"{"sidebar":false}"#, false),
    ] {
        put(&db(&env), value);
        assert_eq!(ok(store.get()), Layout { sidebar }, "{value}");
    }
}

#[test]
fn a_save_keeps_fields_a_newer_lecter_wrote() {
    let env = env();
    put(&db(&env), r#"{"sidebar":true,"rightPanel":false}"#);
    ok(LayoutStore::at(db(&env)).save(Layout { sidebar: false }));
    let raw = stored(&db(&env)).unwrap_or_default();
    let value: serde_json::Value = serde_json::from_str(&raw).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(value, serde_json::json!({ "sidebar": false, "rightPanel": false }));
}

#[test]
fn a_state_db_that_is_not_a_database_is_an_io_error() {
    let env = env();
    let path = db(&env);
    std::fs::create_dir_all(path.parent().unwrap_or(&path)).unwrap_or_else(|e| panic!("{e}"));
    std::fs::write(&path, "this is not SQLite, just text long enough to fill a header page")
        .unwrap_or_else(|e| panic!("{e}"));
    let err = LayoutStore::at(path).get().err().unwrap_or_else(|| panic!("read a broken database"));
    assert_eq!(err, Error::LayoutFailed);
    assert_eq!(err.code(), ErrorCode::Io);
    assert_eq!(err.to_string(), "Lecter could not remember the window's layout.");
}

#[test]
fn the_layout_crosses_ipc_as_an_object_with_a_sidebar_flag() {
    assert_eq!(serde_json::to_value(Layout { sidebar: false }).ok(), Some(serde_json::json!({ "sidebar": false })));
    let parsed: Option<Layout> = serde_json::from_value(serde_json::json!({ "sidebar": true })).ok();
    assert_eq!(parsed, Some(Layout { sidebar: true }));
    // The UI must send the flag, as a boolean.
    assert!(serde_json::from_value::<Layout>(serde_json::json!({})).is_err());
    assert!(serde_json::from_value::<Layout>(serde_json::json!({ "sidebar": "yes" })).is_err());
}
