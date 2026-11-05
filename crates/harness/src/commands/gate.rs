//! The folder-trust answers the harness reads and writes: the same `trusted.jsonc` in the config
//! folder (or the test home's) the app uses, and the core's SEC-27 gate in front of every AI and
//! indexing command (F-033).

use std::path::Path;

use lecter_core::course::trust::{self, TrustStore};
use lecter_core::paths::AppDirs;

use crate::error::HarnessError;

/// The core's error as the harness's: its code and its one-sentence message.
pub fn core_error(e: lecter_core::Error) -> HarnessError {
    HarnessError::new(e.code(), e.to_string())
}

/// The trust answers in this user's config folder, or the test home's.
pub fn store() -> Result<TrustStore, HarnessError> {
    AppDirs::resolve().map(|dirs| TrustStore::new(&dirs)).map_err(core_error)
}

/// SEC-27: succeeds only for a course trusted as it is now; otherwise `E_NOT_TRUSTED`.
pub fn require_trusted(course: &Path) -> Result<(), HarnessError> {
    trust::require_trusted(&store()?, course).map_err(core_error)
}
