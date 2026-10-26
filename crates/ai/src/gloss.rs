//! A gloss as the lecture file stores it (`03-lecture-files.md#body`): a fenced div whose first
//! line is the prompt, e.g.
//!
//! ```markdown
//! ::: {.gloss #g-7f3a kind=ask key=a anchor=s3b2 model="sample" by=ai}
//! **you asked:** how do we get the 2Cov term?
//!
//! Expand the square …
//! :::
//! ```
//!
//! The answer is model output: a line of it that would read as a fence (`:::`) or a slide block
//! (`[…]{#s3b1}`) gets a leading backslash, so it can't end the div or pose as a block.

/// What a gloss's fenced div holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GlossDiv<'a> {
    /// `g-7f3a`.
    pub id: &'a str,
    /// The gloss kind (`ask`, `steps`, …).
    pub kind: &'a str,
    /// The key that made it (`a`).
    pub key: &'a str,
    /// The block it explains (`s3b2`).
    pub anchor: &'a str,
    /// The model that answered.
    pub model: &'a str,
    /// The student's question.
    pub question: &'a str,
    /// The answer, as streamed.
    pub answer: &'a str,
}

/// The fenced div for `g`, without a trailing newline. The question becomes one line (its line
/// breaks turn into spaces); the answer's line endings become `\n` and its trailing blank lines go.
pub fn fenced_div(g: &GlossDiv<'_>) -> String {
    let question = g.question.split_whitespace().collect::<Vec<_>>().join(" ");
    let answer = g.answer.replace("\r\n", "\n").replace('\r', "\n");
    let answer = answer.trim_end();
    let model = g.model.replace(['"', '\\', '}', '\n'], "");
    let mut out = String::with_capacity(answer.len() + question.len() + 128);
    out.push_str(&format!(
        "::: {{.gloss #{} kind={} key={} anchor={} model=\"{model}\" by=ai}}\n",
        g.id, g.kind, g.key, g.anchor
    ));
    out.push_str("**you asked:** ");
    out.push_str(&question);
    out.push('\n');
    if !answer.is_empty() {
        out.push('\n');
        for line in answer.split('\n') {
            out.push_str(&escape_line(line));
            out.push('\n');
        }
    }
    out.push_str(":::");
    out
}

/// `line` with a backslash in front when it would read as a fence or a block span.
fn escape_line(line: &str) -> String {
    let t = line.trim_start();
    if t.starts_with(":::") || t.starts_with('[') { format!("\\{t}") } else { line.to_owned() }
}

/// The most four-digit ids tried before a longer one is used.
const SHORT_TRIES: usize = 32;

/// A new gloss id (`g-` and 4 hex digits, or 8 once short ones keep colliding) that `taken` (the
/// lecture's text) doesn't use yet. `random` supplies the digits.
pub fn new_id(taken: &str, mut random: impl FnMut() -> u32) -> String {
    for _ in 0..SHORT_TRIES {
        let id = format!("g-{:04x}", random() & 0xffff);
        if !uses(taken, &id) {
            return id;
        }
    }
    loop {
        let id = format!("g-{:08x}", random());
        if !uses(taken, &id) {
            return id;
        }
    }
}

/// Whether `text` has an element whose id is exactly `id` (`#g-7f3a` followed by a delimiter).
fn uses(text: &str, id: &str) -> bool {
    let needle = format!("#{id}");
    text.match_indices(&needle).any(|(at, _)| {
        text[at + needle.len()..].chars().next().is_none_or(|c| c.is_whitespace() || c == '}' || c == '.')
    })
}

/// Random digits for [`new_id`], from the standard library's randomly keyed hasher (no extra
/// crate; ids only need to differ, not to be secret).
pub fn random_u32() -> u32 {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos()));
    (h.finish() >> 16) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn div(question: &str, answer: &str) -> String {
        fenced_div(&GlossDiv { id: "g-7f3a", kind: "ask", key: "a", anchor: "s3b2", model: "sample", question, answer })
    }

    #[test]
    fn a_gloss_is_a_fenced_div_with_the_prompt_first() {
        assert_eq!(
            div("how do we get the 2Cov term?", "1. Expand the square.\n2. Collect terms.\n"),
            "::: {.gloss #g-7f3a kind=ask key=a anchor=s3b2 model=\"sample\" by=ai}\n**you asked:** how do we get the 2Cov term?\n\n1. Expand the square.\n2. Collect terms.\n:::"
        );
    }

    #[test]
    fn an_empty_answer_keeps_only_the_prompt() {
        assert_eq!(
            div("why?", " \n"),
            "::: {.gloss #g-7f3a kind=ask key=a anchor=s3b2 model=\"sample\" by=ai}\n**you asked:** why?\n:::"
        );
    }

    #[test]
    fn the_question_is_one_line_and_line_endings_are_normalised() {
        let d = div("two\nlines\r\n here", "a\r\nb\rc");
        assert!(d.contains("**you asked:** two lines here\n\na\nb\nc\n:::"), "{d}");
    }

    #[test]
    fn answer_lines_cannot_close_the_div_or_pose_as_blocks() {
        let d = div(":::", "fine\n:::\n  ::: {.slide #s9}\n[evil]{#s1b1}\n:::");
        assert_eq!(
            d,
            "::: {.gloss #g-7f3a kind=ask key=a anchor=s3b2 model=\"sample\" by=ai}\n**you asked:** :::\n\nfine\n\\:::\n\\::: {.slide #s9}\n\\[evil]{#s1b1}\n\\:::\n:::"
        );
        // Only the div's own fence lines start with `:::`.
        assert_eq!(d.lines().filter(|l| l.starts_with(":::")).count(), 2);
    }

    #[test]
    fn a_model_name_cannot_break_the_attributes() {
        let d = fenced_div(&GlossDiv {
            id: "g-1",
            kind: "ask",
            key: "a",
            anchor: "s1b1",
            model: "x\"} evil",
            question: "q",
            answer: "",
        });
        assert!(d.starts_with("::: {.gloss #g-1 kind=ask key=a anchor=s1b1 model=\"x evil\" by=ai}\n"), "{d}");
    }

    #[test]
    fn new_ids_skip_ids_the_lecture_uses() {
        let text = "::: {.gloss #g-0001 kind=ask}\n::: {.note #g-0002}\n:::\n";
        let mut seq = [1u32, 2, 3].into_iter();
        assert_eq!(new_id(text, || seq.next().unwrap_or(9)), "g-0003");
        // Only whole ids count: g-00011 doesn't use g-0001.
        let mut one = std::iter::repeat(1u32);
        assert_eq!(new_id("#g-00011 #g-0001x", || one.next().unwrap_or(0)), "g-0001");
        // The high bits don't reach a short id.
        let mut big = std::iter::once(0x1234_abcd_u32);
        assert_eq!(new_id("", || big.next().unwrap_or(0)), "g-abcd");
    }

    #[test]
    fn colliding_short_ids_fall_back_to_eight_digits() {
        let mut n = 0u32;
        let id = new_id("{#g-0005}", || {
            n += 1;
            if n <= 32 { 5 } else { 0xdead_beef }
        });
        assert_eq!(id, "g-deadbeef");
    }
}
