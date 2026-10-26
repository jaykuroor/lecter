//! Atomic file replacement (`01-architecture.md#document-model`): write a temp file next to the
//! target, `fsync` it, rename it over the target, then `fsync` the folder so the rename itself
//! is on disk. A crash at any point leaves either the old file or the new one, never a mix.

use std::fs::{File, OpenOptions};
use std::io::{self, ErrorKind, Write};
use std::path::{Path, PathBuf};

/// The temp file for `target`: hidden, in the same folder (a rename across file systems isn't
/// atomic), so course listings skip it.
pub fn temp_path(target: &Path) -> PathBuf {
    let name = target.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    target.with_file_name(format!(".{name}.tmp"))
}

/// Replaces `target` with `bytes`. `before_rename` runs once the temp file is on disk and before
/// it replaces `target` (the journal's checkpoint goes there). Returns the written file, open
/// for further writes; after the rename it is the file at `target`.
///
/// A temp file left by a crash is removed first, and the new one is created exclusively, so a
/// link planted at the temp path is replaced, never followed. A link at `target` is replaced by
/// the rename, never written through.
#[allow(clippy::disallowed_methods, reason = "runs on the session thread, never on the runtime")]
pub fn write(target: &Path, bytes: &[u8], before_rename: impl FnOnce() -> io::Result<()>) -> io::Result<File> {
    let temp = temp_path(target);
    match std::fs::remove_file(&temp) {
        Err(e) if e.kind() != ErrorKind::NotFound => return Err(e),
        _ => {}
    }
    let mut file = OpenOptions::new().write(true).create_new(true).open(&temp)?;
    let written = file.write_all(bytes).and_then(|()| file.sync_all()).and_then(|()| before_rename());
    if let Err(e) = written {
        let _ = std::fs::remove_file(&temp);
        return Err(e);
    }
    if let Err(e) = std::fs::rename(&temp, target) {
        let _ = std::fs::remove_file(&temp);
        return Err(e);
    }
    sync_dir(target)?;
    Ok(file)
}

/// `fsync`s the folder holding `path`, so a rename in it survives a power cut. Windows has no
/// folder handles for this; NTFS journals the rename itself.
#[allow(clippy::disallowed_methods, reason = "runs on the session thread, never on the runtime")]
fn sync_dir(path: &Path) -> io::Result<()> {
    if cfg!(unix)
        && let Some(dir) = path.parent()
    {
        File::open(dir)?.sync_all()?;
    }
    Ok(())
}
