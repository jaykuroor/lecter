//! Saving an open lecture (`01-architecture.md#document-model`): a [`Session`] holds the
//! lecture's text, appends every edit to its journal as it arrives (`fsync`'d at most 250 ms
//! later), and rewrites the `.md` atomically 1 s after the last edit. Opening a session replays
//! the journal entries newer than the file, so a killed app loses at most the edits that hadn't
//! reached the core.
//!
//! Each session runs on its own thread (`actor.rs`), which does the blocking file work; the
//! handle's calls block until the thread answers, so async callers make them in
//! `spawn_blocking`.

mod actor;
pub mod atomic;
mod document;
mod schedule;

use std::io;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, SyncSender};
use std::time::Instant;

pub use document::{Edit, normalize};
pub use schedule::Timing;

use self::actor::{Actor, Msg};
use self::document::Document;
use self::schedule::Schedule;
use crate::course::within;
use crate::error::{Error, Result};
use crate::journal::{self, Existing, Journal, Replay, blake3_hex};
use crate::lecture::{self, Lecture};

/// Requests queued for a session's thread before senders wait. Each caller waits for its own
/// answer, so more than a few never queue; the bound only caps a burst.
const INBOX: usize = 64;

/// What opening a session found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Opened {
    /// The lecture as the buffer shows it: the file's text with `\n` line breaks, plus any
    /// journal edits newer than the file.
    pub lecture: Lecture,
    /// Whether journal edits newer than the file were applied.
    pub recovered: bool,
    /// The journal moved aside because its edits don't apply to the file on disk (ROB-11), if any.
    pub kept_aside: Option<PathBuf>,
}

/// An open lecture that saves itself. Dropping the handle saves pending edits on the session's
/// thread; [`Session::close`] does the same and waits for it.
#[derive(Debug)]
pub struct Session {
    inbox: SyncSender<Msg>,
    rel: String,
}

impl Session {
    /// Opens the lecture at `rel` (`lectures/<name>.md`) of the course folder `course`, replays its
    /// journal and starts saving it, with the spec's delays.
    pub fn open(course: &Path, rel: &str) -> Result<(Self, Opened)> {
        Self::open_with(course, rel, Timing::default())
    }

    /// [`Session::open`] with other delays.
    pub fn open_with(course: &Path, rel: &str, timing: Timing) -> Result<(Self, Opened)> {
        let (mut lecture, root, target) = lecture::open_at(course, rel)?;
        let journal_err = |e: io::Error| Error::JournalFailed { path: rel.to_owned(), kind: e.kind() };
        let disk = blake3_hex(lecture.text.as_bytes());
        let text = normalize(&lecture.text).into_owned();
        let log = journal_dir(&root)?.join(journal::file_name(&lecture.name));
        let replay = match journal::read(&log).map_err(journal_err)? {
            Existing::Missing => Replay::Clean { last_seq: 0 },
            Existing::Bytes(bytes) => journal::replay(&bytes, &disk, &text),
            Existing::Unusable => Replay::Mismatch { last_seq: 0 },
        };
        let (text, edits, last_seq, kept_aside) = match replay {
            Replay::Clean { last_seq } => (text, Vec::new(), last_seq, None),
            Replay::Recovered { text, edits, last_seq } => (text, edits, last_seq, None),
            Replay::Mismatch { last_seq } => {
                (text, Vec::new(), last_seq, Some(journal::keep_aside(&log).map_err(journal_err)?))
            }
        };
        let recovered = !edits.is_empty();
        let journal = Journal::start(&log, &disk, &edits, last_seq + 1).map_err(journal_err)?;
        let mut schedule = Schedule::new(timing);
        if recovered {
            // The `.md` lags the document. (A CRLF file alone isn't rewritten: only an edit saves.)
            schedule.edited(Instant::now());
        }
        let doc = Document::new(&text);
        lecture.text = text;
        let actor = Actor { doc, journal, target, rel: rel.to_owned(), schedule };
        let (inbox, rx) = mpsc::sync_channel(INBOX);
        std::thread::Builder::new()
            .name("lecter-save".into())
            .spawn(move || actor.run(&rx))
            .map_err(|e| Error::JournalFailed { path: rel.to_owned(), kind: e.kind() })?;
        Ok((Self { inbox, rel: rel.to_owned() }, Opened { lecture, recovered, kept_aside }))
    }

    /// Applies `edits` (buffer positions, in order) and returns once they are in the journal.
    /// A batch that doesn't fit the document is refused whole.
    pub fn apply(&self, edits: Vec<Edit>) -> Result<()> {
        self.ask(|reply| Msg::Edits(edits, reply))?
    }

    /// The document's current text.
    pub fn text(&self) -> Result<String> {
        self.ask(Msg::Text)
    }

    /// Saves pending edits and stops the session's thread.
    pub fn close(self) -> Result<()> {
        self.ask(Msg::Close)?
    }

    /// The course-relative path of the lecture.
    pub fn path(&self) -> &str {
        &self.rel
    }

    fn ask<T>(&self, msg: impl FnOnce(SyncSender<T>) -> Msg) -> Result<T> {
        let (reply, answer) = mpsc::sync_channel(1);
        let gone = || Error::LectureClosed(self.rel.clone());
        self.inbox.send(msg(reply)).map_err(|_| gone())?;
        answer.recv().map_err(|_| gone())
    }
}

/// `<root>/.lecter/journal`, created if needed. Each level is checked before anything is created
/// inside it, so a `.lecter` link out of the course is refused, not written through (SEC-35).
#[allow(clippy::disallowed_methods, reason = "runs in spawn_blocking or on the session thread")]
fn journal_dir(root: &Path) -> Result<PathBuf> {
    let io = |e: io::Error| Error::Io(e.kind());
    let mut dir = root.to_path_buf();
    for part in journal::DIR.split('/') {
        dir.push(part);
        match std::fs::create_dir(&dir) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(io(e)),
        }
        let real = std::fs::canonicalize(&dir).map_err(io)?;
        if !within(root, &real) {
            return Err(Error::OutsideCourse(journal::DIR.to_owned()));
        }
        if !std::fs::metadata(&real).map_err(io)?.is_dir() {
            return Err(Error::Io(io::ErrorKind::NotADirectory));
        }
        dir = real;
    }
    Ok(dir)
}

#[cfg(all(test, any(debug_assertions, feature = "test-hooks")))]
mod tests;
