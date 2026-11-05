//! The user's `keymaps.jsonc` in the global config folder (12-settings-theme-onboarding.md#settings,
//! D-199). The core only reads the file's text, capped, and hands it to the UI, which parses it
//! (`ui/src/keys/user.ts`) and lays it over the default keymap. A missing file is no file: the
//! defaults apply. The text is never logged.
//!
//! Everything here blocks on the disk: async callers run it in `spawn_blocking`.

use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};
use crate::paths::AppDirs;

/// The file's name in the global config folder.
pub const KEYMAPS_FILE: &str = "keymaps.jsonc";

/// The largest `keymaps.jsonc` read (D-199): a hand-written file is a few KB.
pub const MAX_KEYMAPS_BYTES: u64 = 256 * 1024;

/// Where `keymaps.jsonc` is. Cloning shares nothing but the path.
#[derive(Debug, Clone)]
pub struct KeymapsFile {
    path: PathBuf,
}

impl KeymapsFile {
    /// `keymaps.jsonc` in `dirs`' config folder.
    pub fn new(dirs: &AppDirs) -> Self {
        Self::at(dirs.config().join(KEYMAPS_FILE))
    }

    /// The file at `path`.
    pub fn at(path: PathBuf) -> Self {
        Self { path }
    }

    /// The file's text; `None` when there is no file. Larger than [`MAX_KEYMAPS_BYTES`], not
    /// UTF-8, or not readable (a folder, no permission) is an error the UI shows once, keeping
    /// the default keys.
    pub fn read(&self) -> Result<Option<String>> {
        read_capped(&self.path)
    }
}

/// Reads at most one byte past the limit, so a huge file is never loaded whole.
#[allow(clippy::disallowed_methods, reason = "callers run this on a blocking thread")]
fn read_capped(path: &Path) -> Result<Option<String>> {
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(Error::KeymapsUnreadable(e.kind())),
    };
    let mut bytes = Vec::new();
    file.take(MAX_KEYMAPS_BYTES + 1).read_to_end(&mut bytes).map_err(|e| Error::KeymapsUnreadable(e.kind()))?;
    if bytes.len() as u64 > MAX_KEYMAPS_BYTES {
        return Err(Error::KeymapsUnusable("is larger than 256 KB"));
    }
    String::from_utf8(bytes).map(Some).map_err(|_| Error::KeymapsUnusable("is not UTF-8 text"))
}

#[cfg(test)]
mod tests;
