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
pub(crate) fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(BUSY_TIMEOUT)?;
    wal(&conn)?;
    Ok(conn)
}

/// [`open`], creating `path`'s folder first: on a first run the data folder may not exist yet.
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
pub(crate) fn open_creating(path: &Path) -> rusqlite::Result<Connection> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| {
            rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CANTOPEN),
                Some(e.to_string()),
            )
        })?;
    }
    open(path)
}

/// Switches to WAL. Two connections switching a new file at once deadlock, and SQLite answers one
/// of them "busy" at once rather than waiting; that one waits for the other's write lock (which
/// does wait, up to the busy timeout) and tries again, by when the file is in WAL already.
fn wal(conn: &Connection) -> rusqlite::Result<()> {
    retry_busy(
        WAL_RETRIES,
        // `journal_mode` answers with the mode it set, so it is read as a query.
        || conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get::<_, String>(0)).map(drop),
        || conn.execute_batch("BEGIN IMMEDIATE; ROLLBACK;"),
    )
}

/// How often the WAL switch is retried after answering "busy".
const WAL_RETRIES: u32 = 3;

/// Runs `op`; each time it answers "busy", runs `wait` and tries again, at most `retries` times.
fn retry_busy<T>(
    retries: u32,
    mut op: impl FnMut() -> rusqlite::Result<T>,
    mut wait: impl FnMut() -> rusqlite::Result<()>,
) -> rusqlite::Result<T> {
    let mut left = retries;
    loop {
        match op() {
            Err(e) if left > 0 && e.sqlite_error_code() == Some(rusqlite::ErrorCode::DatabaseBusy) => {
                left -= 1;
                wait()?;
            }
            other => return other,
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

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use rusqlite::ffi;

    use super::retry_busy;

    fn err(code: i32) -> rusqlite::Error {
        rusqlite::Error::SqliteFailure(ffi::Error::new(code), None)
    }

    /// An op that answers each code in turn (0 = success); returns its result, calls and waits.
    fn run(codes: &[i32], retries: u32) -> (rusqlite::Result<u8>, usize, usize) {
        let (calls, waits) = (Cell::new(0), Cell::new(0));
        let got = retry_busy(
            retries,
            || {
                let code = codes[calls.get()];
                calls.set(calls.get() + 1);
                if code == 0 { Ok(7) } else { Err(err(code)) }
            },
            || {
                waits.set(waits.get() + 1);
                Ok(())
            },
        );
        (got, calls.get(), waits.get())
    }

    fn code(r: rusqlite::Result<u8>) -> Option<rusqlite::ErrorCode> {
        r.err().and_then(|e| e.sqlite_error_code())
    }

    #[test]
    fn busy_answers_wait_and_retry_until_it_works() {
        let (got, calls, waits) = run(&[ffi::SQLITE_BUSY, ffi::SQLITE_BUSY, 0], 3);
        assert_eq!((got.ok(), calls, waits), (Some(7), 3, 2));
        let (got, calls, waits) = run(&[0], 3);
        assert_eq!((got.ok(), calls, waits), (Some(7), 1, 0));
    }

    #[test]
    fn retries_stop_at_the_limit() {
        let busy = [ffi::SQLITE_BUSY; 5];
        let (got, calls, waits) = run(&busy, 3);
        assert_eq!(code(got), Some(rusqlite::ErrorCode::DatabaseBusy));
        assert_eq!((calls, waits), (4, 3));
        let (got, calls, waits) = run(&busy, 0);
        assert_eq!(code(got), Some(rusqlite::ErrorCode::DatabaseBusy));
        assert_eq!((calls, waits), (1, 0));
    }

    #[test]
    fn other_errors_are_not_retried() {
        for c in [ffi::SQLITE_NOTADB, ffi::SQLITE_LOCKED, ffi::SQLITE_IOERR, ffi::SQLITE_CANTOPEN] {
            let (got, calls, waits) = run(&[c, 0], 3);
            assert_eq!(code(got), Some(ffi::Error::new(c).code), "{c}");
            assert_eq!((calls, waits), (1, 0), "{c}");
        }
    }

    #[test]
    fn a_failing_wait_ends_the_retries_with_its_error() {
        let calls = Cell::new(0);
        let got: rusqlite::Result<u8> = retry_busy(
            3,
            || {
                calls.set(calls.get() + 1);
                Err(err(ffi::SQLITE_BUSY))
            },
            || Err(err(ffi::SQLITE_IOERR)),
        );
        assert_eq!(code(got), Some(rusqlite::ErrorCode::SystemIoFailure));
        assert_eq!(calls.get(), 1);
    }
}
