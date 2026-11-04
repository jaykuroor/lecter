//! The migration hook (`01-architecture.md#app-identity-and-migration`): once per identity, move
//! what earlier bundle identifiers left behind to the stable folders and keychain service.

use std::path::{Path, PathBuf};

use super::keychain::{Keychain, KeychainError};
use super::legacy_dirs::{self, LegacyRoot};
use super::record::{self, OnceError, STATE_DB};
use super::{Identity, LEGACY_APP_IDS};
use crate::paths::{AppDirs, BaseDirs, Os};

/// Everything one migration run reads and writes.
pub struct Migration<'a> {
    /// The identity to migrate to (production: [`super::CURRENT`]).
    pub current: Identity,
    /// Earlier bundle identifiers (production: [`LEGACY_APP_IDS`]).
    pub legacy_ids: &'a [&'a str],
    /// The OS whose folder layout applies.
    pub os: Os,
    /// The OS base folders the legacy folders are found in.
    pub base: &'a BaseDirs,
    /// The stable folders: legacy entries move here, and `state.db` lives in its data folder.
    pub dirs: &'a AppDirs,
    /// The OS keychain.
    pub keychain: &'a dyn Keychain,
    /// The keychain accounts Lecter may have saved (the keychain can't list a service).
    pub accounts: &'a [&'a str],
}

impl<'a> Migration<'a> {
    /// The migration this build runs on this OS: [`super::CURRENT`] and [`LEGACY_APP_IDS`].
    pub fn for_host(
        base: &'a BaseDirs,
        dirs: &'a AppDirs,
        keychain: &'a dyn Keychain,
        accounts: &'a [&'a str],
    ) -> Self {
        Self { current: super::CURRENT, legacy_ids: LEGACY_APP_IDS, os: Os::host(), base, dirs, keychain, accounts }
    }
}

/// What [`migrate`] did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// No earlier identifier is listed, so nothing was looked at and nothing was written.
    NothingToMigrate,
    /// `state.db` records that this identity's migration already ran.
    AlreadyDone,
    /// The migration ran and is now recorded.
    Ran(Report),
}

/// What one run moved, discarded and left behind.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Report {
    /// Where each moved entry now is, in the stable folders.
    pub moved: Vec<PathBuf>,
    /// Webview storage that was removed.
    pub discarded: Vec<PathBuf>,
    /// Keychain accounts re-saved under the current service.
    pub secrets: Vec<String>,
    /// What stayed where it was, and why.
    pub left: Vec<Leftover>,
}

/// Something the run left in a legacy location.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Leftover {
    /// A file or folder.
    Path {
        /// Where it still is.
        path: PathBuf,
        /// Why.
        reason: LeftReason,
    },
    /// A keychain item.
    Secret {
        /// The legacy service it is still filed under.
        service: String,
        /// Its account.
        account: String,
        /// What the keychain said.
        reason: KeychainError,
    },
}

/// Why a legacy entry stayed where it was.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LeftReason {
    /// The stable folder already has an entry of that name (this path), which is kept.
    Conflict(PathBuf),
    /// The legacy location is a file or a link, not a folder Tauri made.
    NotAFolder,
    /// The file system refused.
    Io(std::io::ErrorKind),
}

/// Why [`migrate`] stopped without recording a run.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum MigrateError {
    /// A legacy identifier that can't name a folder of its own (empty, a path, `.`/`..`, or the
    /// stable folder name). Nothing was touched.
    #[error("{0:?} is not a usable legacy app identifier")]
    BadLegacyId(String),
    /// The keychain can't be reached; nothing was moved and the run is retried on the next start.
    #[error("the OS keychain is not available; the migration runs on the next start")]
    KeychainUnavailable,
    /// The data folder or `state.db` could not be created, read or written.
    #[error("the app's state.db could not be used: {0}")]
    StateDb(String),
}

/// Moves what the identifiers in `m.legacy_ids` left behind to the stable folders and re-saves
/// their keychain items under `m.current.keychain_service`; old webview storage is discarded. Runs
/// at most once per identity: the run is recorded under `migrated_identity` in the `meta` table of
/// `<data>/state.db`. Blocking (file system and keychain): call it from a blocking thread at start.
#[allow(clippy::disallowed_methods, reason = "runs once at startup on a blocking thread")]
pub fn migrate(m: &Migration<'_>) -> Result<Outcome, MigrateError> {
    if m.legacy_ids.is_empty() {
        return Ok(Outcome::NothingToMigrate);
    }
    if let Some(bad) = m.legacy_ids.iter().find(|id| !usable(id, &m.current)) {
        return Err(MigrateError::BadLegacyId((*bad).to_owned()));
    }
    std::fs::create_dir_all(m.dirs.data()).map_err(|e| MigrateError::StateDb(e.kind().to_string()))?;
    let mut conn = record::open(&m.dirs.data().join(STATE_DB)).map_err(|e| MigrateError::StateDb(e.to_string()))?;
    match record::once(&mut conn, m.current.app_id, || run(m)) {
        Ok(Some(report)) => Ok(Outcome::Ran(report)),
        Ok(None) => Ok(Outcome::AlreadyDone),
        Err(OnceError::Work(e)) => Err(e),
        Err(OnceError::Db(e)) => Err(MigrateError::StateDb(e.to_string())),
    }
}

/// One run: keychain first, so an unreachable keychain stops it before anything moves.
fn run(m: &Migration<'_>) -> Result<Report, MigrateError> {
    let mut report = Report::default();
    for id in m.legacy_ids {
        resave_secrets(m, id, &mut report)?;
    }
    let stable = [m.dirs.config(), m.dirs.data(), m.dirs.cache()];
    for id in m.legacy_ids {
        for root in legacy_dirs::roots(id, m.os, m.base, m.dirs) {
            if overlaps(&root, &stable) {
                continue;
            }
            legacy_dirs::migrate_root(&root, &mut report);
        }
    }
    Ok(report)
}

/// Re-saves every account found under the legacy service `id` under the current service, then
/// removes the legacy item. A secret already saved under the current service is the one in use
/// and is kept; the legacy copy is removed all the same, since keys live only under the current
/// service (SEC-40). An item that fails stays where it is.
fn resave_secrets(m: &Migration<'_>, id: &str, report: &mut Report) -> Result<(), MigrateError> {
    let to = m.current.keychain_service;
    for &account in m.accounts {
        match resave(m.keychain, id, to, account) {
            Ok(true) => report.secrets.push(account.to_owned()),
            Ok(false) => {}
            Err(KeychainError::Unavailable) => return Err(MigrateError::KeychainUnavailable),
            Err(reason) => {
                report.left.push(Leftover::Secret { service: id.to_owned(), account: account.to_owned(), reason });
            }
        }
    }
    Ok(())
}

/// Moves one item; `Ok(true)` when it was re-saved under `to`.
fn resave(kc: &dyn Keychain, from: &str, to: &str, account: &str) -> Result<bool, KeychainError> {
    let Some(mut secret) = kc.get(from, account)? else {
        return Ok(false);
    };
    let saved = match kc.get(to, account) {
        Ok(Some(_)) => Ok(false),
        Ok(None) => kc.set(to, account, &secret).map(|()| true),
        Err(e) => Err(e),
    };
    secret.fill(0);
    let saved = saved?;
    kc.delete(from, account)?;
    Ok(saved)
}

/// Whether `id` names a folder of its own, apart from the stable one. Compared without case, as
/// macOS and Windows file systems do.
fn usable(id: &str, current: &Identity) -> bool {
    let mut parts = Path::new(id).components();
    let one_normal = matches!(parts.next(), Some(std::path::Component::Normal(_))) && parts.next().is_none();
    one_normal
        && !id.contains(['/', '\\', ':'])
        && !id.eq_ignore_ascii_case(current.dir_name)
        && !id.eq_ignore_ascii_case(current.app_id)
}

/// Whether a legacy root is, holds or sits in a stable folder; such a root is never touched.
fn overlaps(root: &LegacyRoot, stable: &[&Path]) -> bool {
    stable.iter().any(|s| s.starts_with(&root.path) || root.path.starts_with(s))
}
