//! Replay on start (`18-contracts.md#journal-records`): apply every `replace` after the last
//! checkpoint whose `base` matches the file on disk. A checkpoint doesn't change the document, so
//! later checkpoints in between are passed over. A truncated last line (a crash mid-write) is
//! ignored. Records that can't be applied to the file on disk are left for the caller to keep
//! aside (ROB-11); they are never applied to a file they weren't written against.

use super::record::{Op, Record};

/// What the journal holds for the file on disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Replay {
    /// Nothing newer than the file: no records after its checkpoint, or no journal at all.
    Clean {
        /// The highest `seq` in the journal, 0 for none.
        last_seq: u64,
    },
    /// Edits newer than the file, applied to its text.
    Recovered {
        /// The document after the edits.
        text: String,
        /// The `replace` records applied, in order.
        edits: Vec<Record>,
        /// The highest `seq` in the journal.
        last_seq: u64,
    },
    /// Edits that can't be applied to the file on disk: it changed outside Lecter, or the journal
    /// is damaged before its last line.
    Mismatch {
        /// The highest `seq` read.
        last_seq: u64,
    },
}

/// The complete records of `log`. `Err(last_seq)` if a line before the last one isn't a record.
fn records(log: &[u8]) -> Result<Vec<Record>, u64> {
    let mut lines: Vec<&[u8]> = log.split(|&b| b == b'\n').collect();
    // The part after the final `\n`: empty, or a line cut short by a crash.
    lines.pop();
    let mut out: Vec<Record> = Vec::with_capacity(lines.len());
    for line in lines {
        match Record::parse(line) {
            Some(r) => out.push(r),
            None => return Err(out.iter().map(|r| r.seq).max().unwrap_or(0)),
        }
    }
    Ok(out)
}

/// Applies one `replace` to `text`, or `None` if its byte range doesn't fit.
fn apply(text: &mut String, from: usize, to: usize, insert: &str) -> Option<()> {
    if from > to || to > text.len() || !text.is_char_boundary(from) || !text.is_char_boundary(to) {
        return None;
    }
    text.replace_range(from..to, insert);
    Some(())
}

/// What `log` (a journal file's bytes) holds for the file on disk, whose BLAKE3 hash is
/// `disk_hash` and whose text, as the buffer holds it, is `text`.
pub fn replay(log: &[u8], disk_hash: &str, text: &str) -> Replay {
    let records = match records(log) {
        Ok(r) => r,
        Err(last_seq) => return Replay::Mismatch { last_seq },
    };
    let last_seq = records.iter().map(|r| r.seq).max().unwrap_or(0);
    let is_checkpoint = |r: &Record| r.op == Op::Checkpoint;
    let start = match records.iter().rposition(|r| is_checkpoint(r) && r.base == disk_hash) {
        Some(i) => i + 1,
        None => {
            // No checkpoint matches. Only edits after the last checkpoint were never saved; if
            // there are none, the file on disk holds everything.
            let after = records.iter().rposition(is_checkpoint).map_or(0, |i| i + 1);
            if records[after..].is_empty() {
                return Replay::Clean { last_seq };
            }
            return Replay::Mismatch { last_seq };
        }
    };
    let edits: Vec<Record> = records[start..].iter().filter(|r| !is_checkpoint(r)).cloned().collect();
    if edits.is_empty() {
        return Replay::Clean { last_seq };
    }
    let mut out = text.to_owned();
    for r in &edits {
        if let Op::Replace { from, to, text } = &r.op
            && apply(&mut out, *from, *to, text).is_none()
        {
            return Replay::Mismatch { last_seq };
        }
    }
    Replay::Recovered { text: out, edits, last_seq }
}
