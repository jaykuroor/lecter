//! The record that the migration ran: key `migrated_identity` in the `meta` table of the app's
//! `state.db` (`18-contracts.md#statedb-schema`), in the data folder.
//!
//! The value is the bundle identifier the data was migrated to, so a later rename (a new entry in
//! [`super::LEGACY_APP_IDS`] and a new [`super::APP_ID`]) runs the migration once more.

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, TransactionBehavior};

/// The file name of the app's `state.db` in the data folder.
pub const STATE_DB: &str = "state.db";

/// The `meta` key that records the identity the data was last migrated to.
pub const MIGRATED_KEY: &str = "migrated_identity";

/// How long a second process waits for the first one's migration to finish before giving up.
const BUSY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// Opens (creating it if needed) `state.db` at `path` in WAL mode with its `meta` table.
pub(super) fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(BUSY_TIMEOUT)?;
    wal(&conn)?;
    Ok(conn)
}

/// Switches to WAL. Two connections switching a new file at once deadlock, and SQLite answers one
/// of them "busy" at once rather than waiting; that one waits for the other's write lock (which
/// does wait, up to the busy timeout) and tries again, by when the file is in WAL already.
fn wal(conn: &Connection) -> rusqlite::Result<()> {
    let mut tries = 0;
    loop {
        // `journal_mode` answers with the mode it set, so it is read as a query.
        match conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get::<_, String>(0)) {
            Ok(_) => return Ok(()),
            Err(e) if tries < 3 && e.sqlite_error_code() == Some(rusqlite::ErrorCode::DatabaseBusy) => {
                tries += 1;
                conn.execute_batch("BEGIN IMMEDIATE; ROLLBACK;")?;
            }
            Err(e) => return Err(e),
        }
    }
}

/// Runs `work` unless `meta` already records `app_id`, then records it, all in one write
/// transaction: a second process blocks until the first commits and then finds the record, so the
/// work runs at most once. `work` returning `Err` rolls back and records nothing.
///
/// Returns `None` when the record was already there.
pub(super) fn once<T, E>(
    conn: &mut Connection,
    app_id: &str,
    work: impl FnOnce() -> Result<T, E>,
) -> Result<Option<T>, OnceError<E>> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(OnceError::Db)?;
    tx.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)", []).map_err(OnceError::Db)?;
    let done: Option<String> = tx
        .query_row("SELECT value FROM meta WHERE key = ?1", [MIGRATED_KEY], |r| r.get(0))
        .optional()
        .map_err(OnceError::Db)?;
    if done.as_deref() == Some(app_id) {
        return Ok(None);
    }
    let out = work().map_err(OnceError::Work)?;
    tx.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)", [MIGRATED_KEY, app_id])
        .map_err(OnceError::Db)?;
    tx.commit().map_err(OnceError::Db)?;
    Ok(Some(out))
}

/// Why [`once`] failed.
#[derive(Debug)]
pub(super) enum OnceError<E> {
    /// `state.db` could not be read or written.
    Db(rusqlite::Error),
    /// The work failed; nothing was recorded.
    Work(E),
}
