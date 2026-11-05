//! The window's layout across restarts (D-195): whether the sidebar shows (`␣e`, 09-ui.md#layout).
//! It is the `layout` key of the `meta` table in the app's `<data>/state.db`, beside the course
//! rail's order (D-188): a JSON object such as `{"sidebar":false}`.
//!
//! The value is read defensively: a field that is missing or of the wrong type reads as its
//! default (the sidebar shows), and anything that isn't an object as the default layout. A save
//! changes only the fields this Lecter knows, keeping any a newer one wrote, in one write
//! transaction.
//!
//! Everything here blocks on the disk: async callers run it in `spawn_blocking`.

use std::path::PathBuf;

use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::error::{Error, Result};
use crate::identity::{STATE_DB, open_state_db_creating};
use crate::paths::AppDirs;

/// The `meta` key that holds the layout.
pub const LAYOUT_KEY: &str = "layout";

/// Which parts of the window show. The first start shows everything.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Layout {
    /// Whether the sidebar (dashboard, lectures, lists, sources) shows beside the course rail.
    pub sidebar: bool,
}

impl Default for Layout {
    fn default() -> Self {
        Self { sidebar: true }
    }
}

/// The layout in `state.db`. Cloning shares nothing but the path.
#[derive(Debug, Clone)]
pub struct LayoutStore {
    db: PathBuf,
}

impl LayoutStore {
    /// The layout in `dirs`' data folder.
    pub fn new(dirs: &AppDirs) -> Self {
        Self::at(dirs.data().join(STATE_DB))
    }

    /// The layout in the `state.db` at `db`.
    pub fn at(db: PathBuf) -> Self {
        Self { db }
    }

    /// The saved layout, or the default when none was saved.
    pub fn get(&self) -> Result<Layout> {
        self.change(|_| false)
    }

    /// Saves `layout`; the next [`get`](Self::get), in this process or after a restart, returns it.
    pub fn save(&self, layout: Layout) -> Result<()> {
        self.change(|stored| {
            stored.insert("sidebar".to_owned(), Value::Bool(layout.sidebar));
            true
        })
        .map(|_| ())
    }

    /// Reads the stored object, lets `edit` change it, and writes it back if `edit` says it
    /// changed, in one write transaction. Returns the layout as it is after.
    fn change(&self, edit: impl FnOnce(&mut Map<String, Value>) -> bool) -> Result<Layout> {
        // The app logs the error's code; SQLite's own message stays out of the UI.
        let failed = |_: rusqlite::Error| Error::LayoutFailed;
        let mut conn = self.connect().map_err(failed)?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(failed)?;
        tx.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)", []).map_err(failed)?;
        let raw: Option<String> = tx
            .query_row("SELECT value FROM meta WHERE key = ?1", [LAYOUT_KEY], |r| r.get(0))
            .optional()
            .map_err(failed)?;
        let mut stored = match raw.and_then(|s| serde_json::from_str(&s).ok()) {
            Some(Value::Object(map)) => map,
            _ => Map::new(),
        };
        if edit(&mut stored) {
            let value = Value::Object(stored.clone()).to_string();
            tx.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)", [LAYOUT_KEY, value.as_str()])
                .map_err(failed)?;
        }
        tx.commit().map_err(failed)?;
        Ok(read(&stored))
    }

    fn connect(&self) -> rusqlite::Result<Connection> {
        open_state_db_creating(&self.db)
    }
}

/// The layout a stored object describes; each field that is missing or not a boolean reads as its
/// default.
fn read(stored: &Map<String, Value>) -> Layout {
    let default = Layout::default();
    Layout { sidebar: stored.get("sidebar").and_then(Value::as_bool).unwrap_or(default.sidebar) }
}

// The fixtures live in a TestEnv home, which exists in debug and test-hooks builds only.
#[cfg(all(test, any(debug_assertions, feature = "test-hooks")))]
mod tests;
