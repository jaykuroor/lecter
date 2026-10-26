//! The open lecture's text in memory (`01-architecture.md#document-model`): a rope, edited with
//! the buffer's positions. CodeMirror counts UTF-16 code units and holds `\n` line breaks only;
//! the journal counts UTF-8 bytes. A lecture is LF-only (`03-lecture-files.md`), so a CRLF or CR
//! file is read with `\n` breaks, exactly as the buffer shows it, and saved that way.

use std::borrow::Cow;

use ropey::Rope;
use serde::{Deserialize, Serialize};

use crate::lecture::MAX_LECTURE_BYTES;

/// One edit from the buffer: replace `from..to` with `text`. Positions are UTF-16 code units
/// into the document as of the previous edit (CodeMirror's positions).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Edit {
    /// The first position replaced.
    pub from: u32,
    /// The position after the last one replaced; `from` for an insert.
    pub to: u32,
    /// The new text; empty for a delete.
    pub text: String,
}

/// Why edits weren't applied. Nothing of a refused batch is applied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refused {
    /// A position past the end, inside a surrogate pair, `from > to`, or a `\r` in the text:
    /// the buffer and the core disagree about the document.
    Misfit,
    /// The document would grow past [`MAX_LECTURE_BYTES`], which no open could read back.
    TooLarge,
}

/// `text` with `\r\n` and lone `\r` line breaks as `\n`, as CodeMirror splits lines.
pub fn normalize(text: &str) -> Cow<'_, str> {
    if text.contains('\r') { Cow::Owned(text.replace("\r\n", "\n").replace('\r', "\n")) } else { Cow::Borrowed(text) }
}

/// The document.
#[derive(Debug, Clone)]
pub struct Document {
    rope: Rope,
}

impl Document {
    /// A document holding `text`, whose line breaks must already be `\n` ([`normalize`]).
    pub fn new(text: &str) -> Self {
        Self { rope: Rope::from_str(text) }
    }

    /// The whole text.
    pub fn text(&self) -> String {
        self.rope.to_string()
    }

    /// Applies `edits` in order, all or none, and returns each as a UTF-8 byte replacement
    /// `(from, to, text)` into the document as of the previous one (the journal's form).
    pub fn apply(&mut self, edits: &[Edit]) -> Result<Vec<(usize, usize, String)>, Refused> {
        // A rope clone shares its nodes, so trying the batch on a copy is cheap.
        let mut rope = self.rope.clone();
        let mut out = Vec::with_capacity(edits.len());
        for e in edits {
            if e.from > e.to || e.text.contains('\r') {
                return Err(Refused::Misfit);
            }
            let from = char_at(&rope, e.from).ok_or(Refused::Misfit)?;
            let to = char_at(&rope, e.to).ok_or(Refused::Misfit)?;
            out.push((rope.char_to_byte(from), rope.char_to_byte(to), e.text.clone()));
            rope.remove(from..to);
            rope.insert(from, &e.text);
            if rope.len_bytes() as u64 > MAX_LECTURE_BYTES {
                return Err(Refused::TooLarge);
            }
        }
        self.rope = rope;
        Ok(out)
    }
}

/// The char index at UTF-16 position `cu`, or `None` past the end or inside a surrogate pair.
fn char_at(rope: &Rope, cu: u32) -> Option<usize> {
    let cu = cu as usize;
    if cu > rope.len_utf16_cu() {
        return None;
    }
    let c = rope.utf16_cu_to_char(cu);
    (rope.char_to_utf16_cu(c) == cu).then_some(c)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edit(from: u32, to: u32, text: &str) -> Edit {
        Edit { from, to, text: text.into() }
    }

    /// CodeMirror counts UTF-16 units; the journal counts UTF-8 bytes. "é" is 1 unit and 2
    /// bytes, "𝑥" (U+1D465) 2 units and 4 bytes.
    #[test]
    fn edits_in_utf16_positions_become_utf8_byte_ranges() {
        let mut doc = Document::new("é𝑥 = 1\n");
        let got = doc.apply(&[edit(3, 3, "!"), edit(0, 1, "e"), edit(5, 7, "")]).unwrap();
        assert_eq!(got, [(6, 6, "!".to_owned()), (0, 2, "e".to_owned()), (7, 9, String::new())]);
        assert_eq!(doc.text(), "e𝑥! 1\n");
    }

    #[test]
    fn each_edit_counts_from_the_one_before() {
        let mut doc = Document::new("ab");
        let got = doc.apply(&[edit(2, 2, "c"), edit(3, 3, "d")]).unwrap();
        assert_eq!(got, [(2, 2, "c".to_owned()), (3, 3, "d".to_owned())]);
        assert_eq!(doc.text(), "abcd");
    }

    #[test]
    fn a_batch_that_does_not_fit_is_refused_whole() {
        // After the first edit the text is "oka𝑥" (5 units): past the end, from > to, inside
        // the surrogate pair, and a CR CodeMirror never sends.
        for bad in [edit(6, 6, "x"), edit(2, 1, ""), edit(4, 4, "x"), edit(0, 0, "a\r\n")] {
            let mut doc = Document::new("a𝑥");
            assert_eq!(doc.apply(&[edit(0, 0, "ok"), bad.clone()]), Err(Refused::Misfit), "{bad:?}");
            assert_eq!(doc.text(), "a𝑥", "{bad:?}");
        }
        let mut doc = Document::new("a𝑥");
        assert_eq!(doc.apply(&[edit(3, 3, "end")]), Ok(vec![(5, 5, "end".to_owned())]));
    }

    #[test]
    fn the_document_never_grows_past_what_an_open_reads() {
        let limit = usize::try_from(MAX_LECTURE_BYTES).unwrap();
        let mut doc = Document::new(&"a".repeat(limit - 1));
        assert_eq!(doc.apply(&[edit(0, 0, "b")]), Ok(vec![(0, 0, "b".to_owned())]));
        assert_eq!(doc.apply(&[edit(0, 0, "c")]), Err(Refused::TooLarge));
        assert_eq!(doc.text().len(), limit);
    }

    #[test]
    fn line_breaks_are_normalised_as_codemirror_splits_them() {
        assert_eq!(normalize("a\r\nb\rc\nd"), "a\nb\nc\nd");
        assert!(matches!(normalize("a\nb"), Cow::Borrowed("a\nb")));
    }
}
