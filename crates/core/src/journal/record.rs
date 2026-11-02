//! One journal line (`18-contracts.md#journal-records`): a JSON object with `v`, `seq`, `ts`,
//! `base` and `op`, plus `from`, `to` and `text` for a `replace`.

use serde::{Deserialize, Serialize};

/// The record format version this build writes and reads.
pub const VERSION: u32 = 1;

/// One journal record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Record {
    /// The format version, [`VERSION`].
    pub v: u32,
    /// Increases by one per record.
    pub seq: u64,
    /// When the record was written, in milliseconds since the Unix epoch.
    pub ts: u64,
    /// The BLAKE3 hash (hex) of the `.md` on disk these records apply on top of; for a
    /// checkpoint, the `.md` that was saved.
    pub base: String,
    /// What happened.
    #[serde(flatten)]
    pub op: Op,
}

/// A record's operation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum Op {
    /// Replace the UTF-8 bytes `from..to` of the document as of the previous record with `text`;
    /// an insert has `from == to`, a delete an empty `text`.
    Replace {
        /// The first byte replaced.
        from: usize,
        /// The byte after the last one replaced.
        to: usize,
        /// The new text.
        text: String,
    },
    /// The `.md` was saved at `base`: earlier records can be dropped.
    Checkpoint,
}

impl Record {
    /// The record as one journal line, with its trailing `\n`.
    pub fn line(&self) -> String {
        // A struct of strings and integers always serialises.
        let mut line = serde_json::to_string(self).unwrap_or_default();
        line.push('\n');
        line
    }

    /// Parses one line (without its `\n`); `None` for anything that isn't a version-1 record.
    pub fn parse(line: &[u8]) -> Option<Self> {
        serde_json::from_slice::<Self>(line).ok().filter(|r| r.v == VERSION)
    }
}
