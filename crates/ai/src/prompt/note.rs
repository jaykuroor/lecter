//! An own note of a lecture file, found by its id (`03-lecture-files.md#body`):
//!
//! ```markdown
//! ::: {.note #n-91c0 anchor=s3b2}
//! Try it with numbers.
//! :::
//! ```
//!
//! The file is untrusted text, so the scan is defensive: only a fence whose own attributes hold
//! the `.note` class and the exact `#id` counts (not a quoted value that spells them), the note
//! must be closed, and divs nested in it (glosses on the note) are left out of its text.

/// An own note: its lines and the block it is anchored to, if any.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Note {
    /// `n-91c0`: letters, digits and `-` only, so it can sit in an attribute as it is.
    pub id: String,
    /// The note's own lines, joined with `\n`, without its fences or nested divs.
    pub text: String,
    /// The `anchor=` block id, when the note has one.
    pub anchor: Option<String>,
}

/// The attributes of a fence line `::: {…}` that matter here: id, classes, `anchor=`.
#[derive(Debug, Default)]
struct Fence<'a> {
    id: &'a str,
    note: bool,
    anchor: Option<&'a str>,
}

/// The attributes of the opening fence on `line`, or `None` if it isn't one.
fn opening(line: &str) -> Option<Fence<'_>> {
    let rest = line.strip_prefix(":::")?.trim_start_matches(':').trim();
    let inner = rest.strip_prefix('{')?.strip_suffix('}')?;
    let mut fence = Fence::default();
    let mut rest = inner;
    loop {
        rest = rest.trim_start();
        if rest.is_empty() {
            return Some(fence);
        }
        // One token: up to a space, but a quoted value runs to its closing quote.
        let mut end = rest.len();
        let mut quoted = false;
        for (i, c) in rest.char_indices() {
            if c == '"' {
                quoted = !quoted;
            } else if c.is_whitespace() && !quoted {
                end = i;
                break;
            }
        }
        let token = &rest[..end];
        rest = &rest[end..];
        if let Some(id) = token.strip_prefix('#') {
            fence.id = id;
        } else if token == ".note" {
            fence.note = true;
        } else if let Some(anchor) = token.strip_prefix("anchor=") {
            fence.anchor = Some(anchor.trim_matches('"'));
        }
    }
}

/// Whether `line` closes a div (`:::` and nothing else).
fn closing(line: &str) -> bool {
    line.starts_with(":::") && line.trim_end().chars().all(|c| c == ':')
}

/// The note `id` (`n-91c0`) of the lecture file `lecture`, or `None` when it has no such closed
/// note (or `id` holds anything but letters, digits and `-`).
pub(crate) fn find_note(lecture: &str, id: &str) -> Option<Note> {
    if !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return None;
    }
    let mut lines = lecture.lines();
    let fence = lines.by_ref().filter_map(opening).find(|f| f.note && f.id == id)?;
    let anchor = fence.anchor.map(str::to_owned);
    let mut kept: Vec<&str> = Vec::new();
    let mut depth = 1usize;
    for line in lines {
        if line.starts_with(":::") && opening(line).is_some() {
            depth += 1;
        } else if closing(line) {
            depth -= 1;
            if depth == 0 {
                return Some(Note { id: id.to_owned(), text: kept.join("\n").trim().to_owned(), anchor });
            }
        } else if depth == 1 {
            kept.push(line);
        }
    }
    None
}
