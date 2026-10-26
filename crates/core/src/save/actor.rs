//! The session's thread: it owns the document, the journal and the `.md`, and handles one message
//! at a time, so every journal record lands in the order its edit was applied and a checkpoint
//! sits exactly where the saved text was taken. It sleeps until the next message or deadline;
//! nothing polls.

use std::path::PathBuf;
use std::sync::mpsc::{Receiver, RecvTimeoutError, SyncSender};
use std::time::Instant;

use super::atomic;
use super::document::{Document, Edit, Refused};
use super::schedule::Schedule;
use crate::error::{Error, Result};
use crate::journal::{Journal, blake3_hex};
use crate::lecture::MAX_LECTURE_BYTES;

/// A journal larger than this is started over after a successful save.
const COMPACT_AT: u64 = 64 * 1024;

/// What the session handle asks of the thread; each request carries its reply channel.
pub(super) enum Msg {
    /// Apply and journal these edits.
    Edits(Vec<Edit>, SyncSender<Result<()>>),
    /// The current text.
    Text(SyncSender<String>),
    /// Save what is pending and stop.
    Close(SyncSender<Result<()>>),
}

/// The thread's state.
pub(super) struct Actor {
    pub(super) doc: Document,
    pub(super) journal: Journal,
    /// The lecture file's canonical path, which saves replace.
    pub(super) target: PathBuf,
    /// The course-relative path, for error messages.
    pub(super) rel: String,
    pub(super) schedule: Schedule,
}

impl Actor {
    /// Handles messages until a `Close` or until every handle is gone; either way pending edits
    /// are saved before the thread ends.
    pub(super) fn run(mut self, inbox: &Receiver<Msg>) {
        loop {
            let msg = match self.schedule.next_deadline() {
                Some(at) => match inbox.recv_timeout(at.saturating_duration_since(Instant::now())) {
                    Ok(m) => Some(m),
                    Err(RecvTimeoutError::Timeout) => None,
                    Err(RecvTimeoutError::Disconnected) => break,
                },
                None => match inbox.recv() {
                    Ok(m) => Some(m),
                    Err(_) => break,
                },
            };
            match msg {
                Some(Msg::Edits(edits, reply)) => {
                    let _ = reply.send(self.edit(&edits));
                }
                Some(Msg::Text(reply)) => {
                    let _ = reply.send(self.doc.text());
                }
                Some(Msg::Close(reply)) => {
                    let _ = reply.send(self.finish());
                    return;
                }
                None => {}
            }
            self.tick(Instant::now());
        }
        let _ = self.finish();
    }

    /// Applies `edits` and writes their records to the journal.
    fn edit(&mut self, edits: &[Edit]) -> Result<()> {
        if edits.is_empty() {
            return Ok(());
        }
        let records = self.doc.apply(edits).map_err(|r| match r {
            Refused::Misfit => Error::EditMisfit(self.rel.clone()),
            Refused::TooLarge => Error::LectureTooLarge { path: self.rel.clone(), limit: MAX_LECTURE_BYTES },
        })?;
        // The document holds the edits now; even if the journal write fails, the save carries them.
        self.schedule.edited(Instant::now());
        self.journal.append_edits(&records).map_err(|e| Error::JournalFailed { path: self.rel.clone(), kind: e.kind() })
    }

    /// Does what is due at `now`.
    fn tick(&mut self, now: Instant) {
        if self.schedule.save_due(now) {
            match self.save() {
                Ok(()) => self.schedule.saved(),
                // ROB-30: the edits stay in the journal; try again later.
                Err(_) => self.schedule.save_failed(now),
            }
        } else if self.schedule.sync_due(now) {
            // A failed fsync can't be retried usefully here; the next edit or save syncs again.
            let _ = self.journal.sync();
            self.schedule.synced();
        }
    }

    /// Writes the document to the `.md`: temp file, fsync, a checkpoint in the journal, rename.
    /// The checkpoint goes in before the rename, so a crash between the two still replays right:
    /// the old file matches the previous checkpoint, the new one this checkpoint.
    fn save(&mut self) -> std::io::Result<()> {
        let text = self.doc.text();
        let hash = blake3_hex(text.as_bytes());
        let journal = &mut self.journal;
        atomic::write(&self.target, text.as_bytes(), || journal.append_checkpoint(&hash))?;
        journal.saved(&hash);
        if journal.len() > COMPACT_AT {
            // The save is done either way; a failed compaction leaves a longer but valid journal.
            let _ = journal.compact();
        }
        Ok(())
    }

    /// Saves pending edits now, or syncs the journal when there are none.
    fn finish(&mut self) -> Result<()> {
        if self.schedule.dirty() {
            self.save().map_err(|e| Error::SaveFailed { path: self.rel.clone(), kind: e.kind() })?;
            self.schedule.saved();
            return Ok(());
        }
        self.journal.sync().map_err(|e| Error::JournalFailed { path: self.rel.clone(), kind: e.kind() })
    }
}
