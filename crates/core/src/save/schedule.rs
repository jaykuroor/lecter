//! When a session `fsync`s its journal and saves its `.md` (`01-architecture.md#document-model`):
//! the journal at most 250 ms after the first write it hasn't synced, the `.md` 1 s after the
//! last edit (debounced). Pure: the session's thread passes the time in, so the tests use a
//! made-up clock.

use std::time::{Duration, Instant};

/// The two delays.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Timing {
    /// From the first unsynced journal write to its `fsync`.
    pub journal_sync: Duration,
    /// From the last edit to the save of the `.md`.
    pub save_debounce: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Self { journal_sync: Duration::from_millis(250), save_debounce: Duration::from_secs(1) }
    }
}

/// What is due and when.
#[derive(Debug, Clone)]
pub struct Schedule {
    timing: Timing,
    sync_at: Option<Instant>,
    save_at: Option<Instant>,
}

impl Schedule {
    /// Nothing due.
    pub const fn new(timing: Timing) -> Self {
        Self { timing, sync_at: None, save_at: None }
    }

    /// Edits were written to the journal at `now`: sync within `journal_sync` of the first
    /// unsynced one, and save `save_debounce` after this one.
    pub fn edited(&mut self, now: Instant) {
        self.sync_at.get_or_insert(now + self.timing.journal_sync);
        self.save_at = Some(now + self.timing.save_debounce);
    }

    /// The next moment something is due, if anything is pending.
    pub fn next_deadline(&self) -> Option<Instant> {
        match (self.sync_at, self.save_at) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        }
    }

    /// Whether the journal `fsync` is due at `now`.
    pub fn sync_due(&self, now: Instant) -> bool {
        self.sync_at.is_some_and(|t| t <= now)
    }

    /// Whether the save is due at `now`.
    pub fn save_due(&self, now: Instant) -> bool {
        self.save_at.is_some_and(|t| t <= now)
    }

    /// Whether a save is pending (the `.md` lags the document).
    pub const fn dirty(&self) -> bool {
        self.save_at.is_some()
    }

    /// The journal was synced.
    pub const fn synced(&mut self) {
        self.sync_at = None;
    }

    /// The `.md` was saved (which also syncs the journal).
    pub const fn saved(&mut self) {
        self.save_at = None;
        self.sync_at = None;
    }

    /// The save failed at `now`: try again one debounce later. The edits stay in the journal.
    pub fn save_failed(&mut self, now: Instant) {
        self.save_at = Some(now + self.timing.save_debounce);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MS: Duration = Duration::from_millis(1);

    #[test]
    fn nothing_is_due_before_an_edit() {
        let s = Schedule::new(Timing::default());
        assert_eq!(s.next_deadline(), None);
        assert!(!s.dirty());
    }

    /// The journal is synced 250 ms after the first unsynced write, however many follow.
    #[test]
    fn the_journal_syncs_250_ms_after_the_first_unsynced_write() {
        let t0 = Instant::now();
        let mut s = Schedule::new(Timing::default());
        s.edited(t0);
        s.edited(t0 + 100 * MS);
        s.edited(t0 + 200 * MS);
        assert_eq!(s.next_deadline(), Some(t0 + 250 * MS));
        assert!(!s.sync_due(t0 + 249 * MS));
        assert!(s.sync_due(t0 + 250 * MS));
        s.synced();
        assert!(!s.sync_due(t0 + 400 * MS));
        // The next write starts a new batch.
        s.edited(t0 + 500 * MS);
        assert!(!s.sync_due(t0 + 749 * MS));
        assert!(s.sync_due(t0 + 750 * MS));
    }

    /// The save waits for 1 s without edits.
    #[test]
    fn the_save_is_debounced_to_1_s_after_the_last_edit() {
        let t0 = Instant::now();
        let mut s = Schedule::new(Timing::default());
        s.edited(t0);
        s.synced();
        s.edited(t0 + 600 * MS);
        s.synced();
        assert_eq!(s.next_deadline(), Some(t0 + 1600 * MS));
        assert!(!s.save_due(t0 + 1000 * MS));
        assert!(!s.save_due(t0 + 1599 * MS));
        assert!(s.save_due(t0 + 1600 * MS));
        assert!(s.dirty());
        s.saved();
        assert!(!s.dirty());
        assert_eq!(s.next_deadline(), None);
    }

    #[test]
    fn the_deadline_is_the_earlier_of_sync_and_save() {
        let t0 = Instant::now();
        let mut s = Schedule::new(Timing { journal_sync: 300 * MS, save_debounce: 100 * MS });
        s.edited(t0);
        assert_eq!(s.next_deadline(), Some(t0 + 100 * MS));
        let mut s = Schedule::new(Timing { journal_sync: 100 * MS, save_debounce: 300 * MS });
        s.edited(t0);
        assert_eq!(s.next_deadline(), Some(t0 + 100 * MS));
        s.synced();
        assert_eq!(s.next_deadline(), Some(t0 + 300 * MS));
    }

    /// ROB-30: a failed save stays pending and is tried again one debounce later.
    #[test]
    fn a_failed_save_is_retried_a_debounce_later() {
        let t0 = Instant::now();
        let mut s = Schedule::new(Timing::default());
        s.edited(t0);
        s.save_failed(t0 + 1000 * MS);
        assert!(s.dirty());
        assert!(!s.save_due(t0 + 1999 * MS));
        assert!(s.save_due(t0 + 2000 * MS));
    }

    #[test]
    fn a_save_also_counts_as_a_sync() {
        let t0 = Instant::now();
        let mut s = Schedule::new(Timing::default());
        s.edited(t0);
        s.saved();
        assert!(!s.sync_due(t0 + 300 * MS));
    }
}
