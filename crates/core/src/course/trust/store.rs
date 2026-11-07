//! `trusted.jsonc` in the global config folder (`12-settings-theme-onboarding.md#settings`): the
//! trust answers of this device, keyed by the course's canonical absolute path.
//!
//! ```jsonc
//! {
//!   "version": 1,
//!   "courses": {
//!     "/home/sam/STAT311": { "choice": "trusted", "fingerprint": "<64 hex digits>" }
//!   }
//! }
//! ```
//!
//! A missing file holds no answers. A file Lecter can't use (broken JSONC, too large, another
//! version, a malformed entry) also counts as holding no answers for those courses: the user is
//! asked again, nothing is ever loosened, and the next answer rewrites the file.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use serde::{Deserialize, Serialize};

use super::TrustChoice;
use crate::error::{Error, Result};
use crate::paths::AppDirs;
use crate::settings::jsonc;

/// The file name in the config folder.
pub const TRUST_FILE: &str = "trusted.jsonc";

/// The format version this build reads and writes.
const VERSION: u32 = 1;

/// The comment written at the top of the file.
const HEADER: &str = "// Lecter: course folders you answered the trust question for, on this device.\n\
// Remove a course's entry to be asked again.\n";

/// One stored answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrustEntry {
    /// What the user chose.
    pub choice: TrustChoice,
    /// The fingerprint of the course's AI files when the user chose.
    pub fingerprint: String,
}

/// The whole file.
#[derive(Debug, Default, Serialize, Deserialize)]
struct TrustFile {
    version: u32,
    courses: BTreeMap<String, serde_json::Value>,
}

/// The trust answers in one config folder. Clones share one lock, held by every change from
/// reading the file to writing it back, so two changes never lose one another.
#[derive(Debug, Clone)]
pub struct TrustStore {
    config: PathBuf,
    changing: Arc<Mutex<()>>,
}

impl PartialEq for TrustStore {
    fn eq(&self, other: &Self) -> bool {
        self.config == other.config
    }
}

impl Eq for TrustStore {}

impl TrustStore {
    /// The answers in this user's config folder (or the test home's).
    pub fn new(dirs: &AppDirs) -> Self {
        Self::in_folder(dirs.config().to_path_buf())
    }

    /// The answers in the config folder `config`.
    pub fn in_folder(config: PathBuf) -> Self {
        Self { config, changing: Arc::default() }
    }

    /// The config folder, where the global settings also live.
    pub fn config_dir(&self) -> &Path {
        &self.config
    }

    /// The `trusted.jsonc` path.
    pub fn file(&self) -> PathBuf {
        self.config.join(TRUST_FILE)
    }

    /// The stored answer for the course at the canonical path `course`, compared exactly.
    pub fn get(&self, course: &str) -> Result<Option<TrustEntry>> {
        Ok(self.read()?.courses.get(course).and_then(|v| serde_json::from_value(v.clone()).ok()))
    }

    /// Stores `entry` for `course`, keeping every other course's entry, and writes the file
    /// atomically (creating the config folder if needed).
    pub fn set(&self, course: &str, entry: TrustEntry) -> Result<()> {
        self.update(course, |_| Some(entry)).map(drop)
    }

    /// Reads `course`'s stored answer and, when `change` returns a new one, stores it, all under
    /// the store's lock (compare-and-set). Returns whether it stored one.
    pub fn update(&self, course: &str, change: impl FnOnce(Option<TrustEntry>) -> Option<TrustEntry>) -> Result<bool> {
        let _one = self.changing.lock().unwrap_or_else(PoisonError::into_inner);
        let mut file = self.read()?;
        let current = file.courses.get(course).and_then(|v| serde_json::from_value(v.clone()).ok());
        let Some(entry) = change(current) else { return Ok(false) };
        file.version = VERSION;
        let value = serde_json::to_value(&entry).map_err(|_| Error::TrustFileWrite(std::io::ErrorKind::InvalidData))?;
        file.courses.insert(course.to_owned(), value);
        let body =
            serde_json::to_string_pretty(&file).map_err(|_| Error::TrustFileWrite(std::io::ErrorKind::InvalidData))?;
        write(&self.file(), &format!("{HEADER}{body}\n")).map(|()| true)
    }

    /// The file's answers; anything unusable reads as none (the user is asked again).
    fn read(&self) -> Result<TrustFile> {
        let text = match jsonc::read_text(&self.file()) {
            Ok(Some(text)) => text,
            Ok(None) => return Ok(TrustFile::default()),
            // A refused read is the disk's problem, not a missing answer: say so.
            Err(jsonc::FileError::Io(kind)) => return Err(Error::Io(kind)),
            Err(_) => return Ok(TrustFile::default()),
        };
        let parsed = jsonc::parse(&text).ok().and_then(|v| serde_json::from_value::<TrustFile>(v).ok());
        Ok(parsed.filter(|f| f.version == VERSION).unwrap_or_default())
    }
}

/// Writes `text` to `path` atomically, creating its folder.
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
fn write(path: &Path, text: &str) -> Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| Error::TrustFileWrite(e.kind()))?;
    }
    crate::save::atomic::write(path, text.as_bytes(), || Ok(())).map(drop).map_err(|e| Error::TrustFileWrite(e.kind()))
}
