//! A lecture's front-matter `date` (03-lecture-files.md#front-matter) for the sidebar (D-194).
//!
//! The course listing reads only the first [`HEAD_BYTES`] of each lecture file: enough for any
//! front matter Lecter writes, and a fixed cost per file however large or hostile it is. The bytes
//! are untrusted (13-security.md): nothing here allocates more than the head, a line cut off by the
//! limit is ignored, and only a value shaped exactly like `YYYY-MM-DD` comes back.
//!
//! Everything here blocks on the disk: async callers run it in `spawn_blocking`.

use std::io::Read;
use std::path::Path;

/// The most bytes read from one lecture to find its date.
pub const HEAD_BYTES: u64 = 4096;

/// The `date` in the front matter of the lecture at `real` (a canonical path the listing checked
/// to be a regular file under the course root), or `None`: no front matter, no date, a date of
/// another shape, or a file that can't be read. Never an error: a lecture without a date still
/// lists.
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
pub(super) fn lecture_date(real: &Path) -> Option<String> {
    let file = std::fs::File::open(real).ok()?;
    // The listing checked that `real` is a regular file just before; checked again on the open
    // handle, since the path may have been swapped since (as `lecture::open` does).
    if !file.metadata().ok()?.is_file() {
        return None;
    }
    let mut head = Vec::with_capacity(HEAD_BYTES as usize);
    file.take(HEAD_BYTES).read_to_end(&mut head).ok()?;
    let whole = (head.len() as u64) < HEAD_BYTES;
    date_in(&head, whole)
}

/// The front-matter `date` in `head`, the start of a lecture file; `whole` says `head` is the
/// whole file, so its last line is complete even without a newline.
///
/// Front matter is a first line `---`, then YAML lines up to `---` or `...`. The date is the first
/// top-level `date:` key (no indentation); its value may be quoted and may carry a `# comment`.
pub(super) fn date_in(head: &[u8], whole: bool) -> Option<String> {
    let head = head.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(head);
    let mut lines = head.split(|&b| b == b'\n');
    // The piece after the last newline is cut off by the limit, unless the file ended there.
    let complete = head.iter().filter(|&&b| b == b'\n').count() + usize::from(whole);
    let mut lines = (&mut lines).take(complete).map(|l| l.strip_suffix(b"\r").unwrap_or(l));
    if lines.next()? != b"---" {
        return None;
    }
    for line in lines {
        if line == b"---" || line == b"..." {
            return None;
        }
        if let Some(value) = line.strip_prefix(b"date:") {
            return iso_day(value);
        }
    }
    None
}

/// `value` (after `date:`) as `YYYY-MM-DD`, or `None`. Spaces, one pair of matching quotes and a
/// trailing `# comment` are allowed around it; whether it is a real calendar day is the UI's to
/// judge (it shows nothing for one that isn't).
fn iso_day(value: &[u8]) -> Option<String> {
    let value = match value.iter().position(|&b| b == b'#') {
        // YAML starts a comment at a `#` after whitespace.
        Some(i) if i > 0 && value[i - 1].is_ascii_whitespace() => &value[..i],
        _ => value,
    };
    let value = value.trim_ascii();
    let value = [b'"', b'\'']
        .iter()
        .find_map(|&q| value.strip_prefix(&[q]).and_then(|v| v.strip_suffix(&[q])))
        .unwrap_or(value);
    let shaped = value.len() == 10
        && value.iter().enumerate().all(|(i, b)| if i == 4 || i == 7 { *b == b'-' } else { b.is_ascii_digit() });
    // Only ASCII digits and dashes are left, so this is valid UTF-8.
    if shaped { String::from_utf8(value.to_vec()).ok() } else { None }
}

#[cfg(test)]
mod tests;
