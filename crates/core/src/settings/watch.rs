//! Applies settings files edited on disk without a restart: OS file events (no polling) on the
//! folders that hold them, coalesced briefly, then a reload. New values are in force well within
//! the 1 s the spec allows.

use std::collections::BTreeSet;
use std::ffi::OsString;
use std::path::Path;
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};

use super::store::{Notice, SettingsStore};

/// How long events must stop before a reload: one editor save is often several events
/// (truncate, write, rename).
pub(super) const QUIET: Duration = Duration::from_millis(50);
/// The longest a burst of events delays a reload.
pub(super) const MAX_DELAY: Duration = Duration::from_millis(300);

/// Why watching couldn't start.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum WatchError {
    /// The OS file-event API refused.
    #[error("could not watch the settings files: {0}")]
    Watch(String),
    /// The config folder couldn't be created.
    #[error("could not create the config folder ({0:?})")]
    Io(std::io::ErrorKind),
}

/// Watches a [`SettingsStore`]'s files while alive; dropping it stops watching.
#[derive(Debug)]
pub struct SettingsWatcher {
    _watcher: RecommendedWatcher,
}

impl SettingsWatcher {
    /// Starts watching `store`'s files. After each change on disk the store reloads, then
    /// `on_change` runs (on the watcher's own thread) with the new notices, whenever a value may
    /// have changed or there is something new to report. Creates the global config folder if
    /// it is missing, so a `config.jsonc` made later is seen too.
    #[allow(clippy::disallowed_methods, reason = "runs once at startup, on a blocking thread")]
    pub fn start(
        store: Arc<SettingsStore>,
        on_change: impl FnMut(Vec<Notice>) + Send + 'static,
    ) -> Result<Self, WatchError> {
        let files = store.files();
        // Unbounded, but the watcher thread drains it continuously and events are tiny.
        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
        let mut watcher = notify::recommended_watcher(tx).map_err(|e| WatchError::Watch(e.to_string()))?;
        let mut dirs = BTreeSet::new();
        for (i, file) in files.iter().enumerate() {
            let Some(dir) = file.parent() else { continue };
            if i == 0 {
                std::fs::create_dir_all(dir).map_err(|e| WatchError::Io(e.kind()))?;
            } else if !dir.is_dir() {
                continue;
            }
            if dirs.insert(dir.to_path_buf()) {
                // The folder, not the file: editors replace files by renaming, which ends a watch
                // on the file itself.
                watcher.watch(dir, RecursiveMode::NonRecursive).map_err(|e| WatchError::Watch(e.to_string()))?;
            }
        }
        let names: BTreeSet<OsString> = files.iter().filter_map(|f| f.file_name().map(OsString::from)).collect();
        std::thread::Builder::new()
            .name("settings-watch".into())
            .spawn(move || run(&rx, &names, &store, on_change))
            .map_err(|e| WatchError::Io(e.kind()))?;
        Ok(Self { _watcher: watcher })
    }
}

/// The watcher thread: ends when the watcher (the channel's sender) is dropped.
fn run(
    rx: &Receiver<notify::Result<Event>>,
    names: &BTreeSet<OsString>,
    store: &SettingsStore,
    mut on_change: impl FnMut(Vec<Notice>),
) {
    while let Ok(event) = rx.recv() {
        if !touches(&event, names) {
            continue;
        }
        if !settle(rx) {
            return;
        }
        let changed = store.reload();
        let notices = store.take_notices();
        if changed || !notices.is_empty() {
            on_change(notices);
        }
    }
}

/// Waits until events stop for [`QUIET`], or [`MAX_DELAY`] has passed since the first; the events
/// are dropped. False when the watcher is gone.
pub(super) fn settle<T>(rx: &Receiver<T>) -> bool {
    let start = Instant::now();
    loop {
        match rx.recv_timeout(QUIET) {
            Ok(_) if start.elapsed() < MAX_DELAY => {}
            Ok(_) | Err(RecvTimeoutError::Timeout) => return true,
            Err(RecvTimeoutError::Disconnected) => return false,
        }
    }
}

/// Whether the event is about one of the settings files. An error from the OS (a lost event
/// queue) counts, since the files may have changed unseen.
pub(super) fn touches(event: &notify::Result<Event>, names: &BTreeSet<OsString>) -> bool {
    match event {
        Ok(event) => event.paths.iter().any(|p| named(p, names)),
        Err(_) => true,
    }
}

fn named(path: &Path, names: &BTreeSet<OsString>) -> bool {
    path.file_name().is_some_and(|n| names.contains(n))
}
