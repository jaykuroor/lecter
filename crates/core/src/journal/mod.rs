//! The edit journal (`01-architecture.md#document-model`, `18-contracts.md#journal-records`):
//! `.lecter/journal/<lecture-file-stem>.log`, one JSON record per line, append-only.
//!
//! [`Journal`] writes it. Each edit is written to the file as it arrives, so a killed process
//! loses nothing it acknowledged, and `fsync`'d in batches by the caller (`save::Session`) at
//! most 250 ms apart. A fresh log is written to a temp file and renamed into place, so a crash
//! leaves either the old log or the new one. [`replay`] reads one back on start.
//!
//! Everything here blocks on the file system: it runs on the session's own thread.

mod hash;
mod record;
mod replay;

use std::fs::File;
use std::io::{self, ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub use hash::blake3_hex;
pub use record::{Op, Record, VERSION};
pub use replay::{Replay, replay};

use crate::save::atomic;

/// The journal folder, relative to the course root.
pub const DIR: &str = ".lecter/journal";

/// The largest journal a replay reads. A lecture is at most 16 MB; a journal larger than this
/// didn't come from typing between two saves, so it is kept aside rather than read.
pub const MAX_JOURNAL_BYTES: u64 = 64 * 1024 * 1024;

/// The journal file name for the lecture file `name` (`l07.md` → `l07.log`).
pub fn file_name(name: &str) -> String {
    let stem = Path::new(name).file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    format!("{stem}.log")
}

/// Milliseconds since the Unix epoch.
pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// What is at a journal path.
#[derive(Debug, PartialEq, Eq)]
pub enum Existing {
    /// No journal yet.
    Missing,
    /// The journal's bytes.
    Bytes(Vec<u8>),
    /// Something that can't be read as a journal: a link, a folder, or a file over
    /// [`MAX_JOURNAL_BYTES`].
    Unusable,
}

/// Reads the journal at `path`, without following a link there.
#[allow(clippy::disallowed_methods, reason = "runs on the session thread, never on the runtime")]
pub fn read(path: &Path) -> io::Result<Existing> {
    let meta = match std::fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Existing::Missing),
        Err(e) => return Err(e),
    };
    if !meta.is_file() || meta.len() > MAX_JOURNAL_BYTES {
        return Ok(Existing::Unusable);
    }
    let mut bytes = Vec::new();
    File::open(path)?.take(MAX_JOURNAL_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_JOURNAL_BYTES {
        return Ok(Existing::Unusable);
    }
    Ok(Existing::Bytes(bytes))
}

/// Moves the journal at `path` aside to `<name>.kept-<ms>`, next to it, so its records survive
/// for the external-edit flow (ROB-11) while a fresh journal starts.
#[allow(clippy::disallowed_methods, reason = "runs on the session thread, never on the runtime")]
pub fn keep_aside(path: &Path) -> io::Result<PathBuf> {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("journal.log");
    let kept = path.with_file_name(format!("{name}.kept-{}", now_ms()));
    std::fs::rename(path, &kept)?;
    Ok(kept)
}

/// An open journal, appending to `.lecter/journal/<stem>.log`.
#[derive(Debug)]
pub struct Journal {
    path: PathBuf,
    file: File,
    next_seq: u64,
    /// The hash of the `.md` on disk, which new edits apply on top of.
    base: String,
    /// Bytes in the file.
    len: u64,
}

impl Journal {
    /// Starts a fresh journal at `path`: a checkpoint of `base` (the `.md` on disk), then `edits`
    /// (`replace` records not yet saved) renumbered from `next_seq`. Whatever was at `path` is
    /// replaced atomically; an existing link there is replaced, never followed.
    pub fn start(path: &Path, base: &str, edits: &[Record], next_seq: u64) -> io::Result<Self> {
        let mut seq = next_seq;
        let mut text = String::new();
        let mut push = |op: Op| {
            text.push_str(&Record { v: VERSION, seq, ts: now_ms(), base: base.to_owned(), op }.line());
            seq += 1;
        };
        push(Op::Checkpoint);
        for r in edits {
            push(r.op.clone());
        }
        let file = atomic::write(path, text.as_bytes(), || Ok(()))?;
        Ok(Self { path: path.to_owned(), file, next_seq: seq, base: base.to_owned(), len: text.len() as u64 })
    }

    /// Appends one `replace` record per `(from, to, text)`, in order, with one write. The records
    /// are in the file (not yet `fsync`'d) when this returns.
    pub fn append_edits(&mut self, edits: &[(usize, usize, String)]) -> io::Result<()> {
        let mut text = String::new();
        for (from, to, insert) in edits {
            let op = Op::Replace { from: *from, to: *to, text: insert.clone() };
            text.push_str(&self.record(op).line());
        }
        self.write(&text)
    }

    /// Appends a checkpoint of `base` (the `.md` about to be renamed into place) and `fsync`s the
    /// journal. New edits keep the old base until [`Self::saved`].
    pub fn append_checkpoint(&mut self, base: &str) -> io::Result<()> {
        let mut r = self.record(Op::Checkpoint);
        base.clone_into(&mut r.base);
        self.write(&r.line())?;
        self.sync()
    }

    /// The `.md` on disk is now `base`.
    pub fn saved(&mut self, base: &str) {
        base.clone_into(&mut self.base);
    }

    /// Starts the journal over with a checkpoint of the current base: everything before it is in
    /// the `.md` on disk.
    pub fn compact(&mut self) -> io::Result<()> {
        *self = Self::start(&self.path, &self.base, &[], self.next_seq)?;
        Ok(())
    }

    /// Flushes everything written to the disk.
    #[allow(clippy::disallowed_methods, reason = "runs on the session thread, never on the runtime")]
    pub fn sync(&mut self) -> io::Result<()> {
        self.file.sync_data()
    }

    /// The journal file's size in bytes.
    pub const fn size(&self) -> u64 {
        self.len
    }

    /// The file this journal appends to.
    pub fn path(&self) -> &Path {
        &self.path
    }

    fn record(&mut self, op: Op) -> Record {
        let r = Record { v: VERSION, seq: self.next_seq, ts: now_ms(), base: self.base.clone(), op };
        self.next_seq += 1;
        r
    }

    fn write(&mut self, text: &str) -> io::Result<()> {
        self.file.write_all(text.as_bytes())?;
        self.len += text.len() as u64;
        Ok(())
    }
}

// The fixtures live in a TestEnv home, which exists in debug and test-hooks builds only.
#[cfg(all(test, any(debug_assertions, feature = "test-hooks")))]
mod tests;
