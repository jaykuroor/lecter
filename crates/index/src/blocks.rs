//! The slide blocks of a lecture file (`03-lecture-files.md#body`), as search indexes them: one
//! `[text]{#s3b1}` span per line inside `::: {.slide #s3 …}` divs, under a front matter whose
//! `title:` names the lecture. The lines are read the way the buffer reads them
//! (`ui/src/features/buffer/syntax.ts`), so search and the buffer agree on what a block is.
//!
//! The file is untrusted text: everything here is a linear scan with no recursion, and a line that
//! isn't exactly a block span is simply not a block.

/// One slide block of a lecture.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Block {
    /// The slide's id, from the block id: `s3` for `s3b1`.
    pub slide: String,
    /// The block's id, e.g. `s3b1`.
    pub block: String,
    /// The block's text as written between `[` and `]{`.
    pub text: String,
    /// Where the block sits: the lecture title and the slide title, joined by ` › `.
    pub breadcrumb: String,
    /// The slide's `src` (`A3`: first slide file, slide 3); empty when the fence has none.
    pub source: String,
    /// Whether the block or its slide carries `.flag`.
    pub flagged: bool,
}

/// Pandoc attributes `{#id .class key=value key="value"}`.
#[derive(Debug, Default, PartialEq, Eq)]
struct Attrs {
    id: String,
    classes: Vec<String>,
    values: Vec<(String, String)>,
}

impl Attrs {
    fn value(&self, key: &str) -> Option<&str> {
        self.values.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
    }

    fn has_class(&self, class: &str) -> bool {
        self.classes.iter().any(|c| c == class)
    }
}

/// The most lines front matter may take; a `---` line with no end in reach isn't front matter
/// (the buffer's `FRONT_MATTER_MAX_LINES`).
const FRONT_MATTER_MAX_LINES: usize = 1000;

/// The slide blocks of `text` (a whole lecture file), in file order.
pub fn lecture_blocks(text: &str) -> Vec<Block> {
    let lines: Vec<&str> = text.lines().collect();
    let fm_end = front_matter_end(&lines);
    let title = lines.get(1..fm_end).map(front_matter_title).unwrap_or_default();
    let mut out = Vec::new();
    let mut slide = SlideContext::default();
    for (i, line) in lines.iter().enumerate().skip(fm_end) {
        if line.starts_with(":::") {
            if let Some(attrs) = slide_fence(line) {
                let named = attrs.value("title").unwrap_or_default().to_owned();
                // A fence without `title=` takes its `## ` line's text, as the buffer shows it.
                let heading = lines.get(i + 1).and_then(|l| l.strip_prefix("## ")).unwrap_or_default();
                slide = SlideContext {
                    title: if named.is_empty() { heading.trim().to_owned() } else { named },
                    source: attrs.value("src").unwrap_or_default().to_owned(),
                    flagged: attrs.has_class("flag"),
                };
            }
            continue;
        }
        if let Some((span, attrs)) = block_span(line) {
            let Some(slide_id) = slide_of(&attrs.id) else { continue };
            out.push(Block {
                slide: slide_id.to_owned(),
                block: attrs.id.clone(),
                text: span.to_owned(),
                breadcrumb: breadcrumb(&title, &slide.title),
                source: slide.source.clone(),
                flagged: slide.flagged || attrs.has_class("flag"),
            });
        }
    }
    out
}

/// The slide fence most recently read.
#[derive(Debug, Default)]
struct SlideContext {
    title: String,
    source: String,
    flagged: bool,
}

fn breadcrumb(lecture: &str, slide: &str) -> String {
    match (lecture.is_empty(), slide.is_empty()) {
        (false, false) => format!("{lecture} › {slide}"),
        (false, true) => lecture.to_owned(),
        _ => slide.to_owned(),
    }
}

/// The index of the first line after the front matter, or 0 when the file has none.
fn front_matter_end(lines: &[&str]) -> usize {
    if lines.first() != Some(&"---") {
        return 0;
    }
    let last = lines.len().min(FRONT_MATTER_MAX_LINES);
    (1..last).find(|&n| lines[n] == "---" || lines[n] == "...").map_or(0, |n| n + 1)
}

/// The front matter's `title:` value, unquoted.
fn front_matter_title(lines: &[&str]) -> String {
    lines.iter().find_map(|l| l.strip_prefix("title:")).map(|v| unquote(v.trim()).to_owned()).unwrap_or_default()
}

fn unquote(v: &str) -> &str {
    for q in ['"', '\''] {
        if let Some(inner) = v.strip_prefix(q).and_then(|r| r.strip_suffix(q)) {
            return inner;
        }
    }
    v
}

/// The attributes of a slide's opening fence `::: {.slide #s3 n=3 …}`, or `None`.
fn slide_fence(line: &str) -> Option<Attrs> {
    let rest = line.trim_start_matches(':');
    if line.len() - rest.len() < 3 {
        return None;
    }
    let inner = rest.trim().strip_prefix('{')?.strip_suffix('}')?;
    if inner.contains('}') {
        return None;
    }
    let attrs = parse_attrs(inner);
    attrs.has_class("slide").then_some(attrs)
}

/// A block line `[text]{#s3b1 .flag}`: its text and attributes, or `None`. Same as the buffer's
/// `^\[(.*)\]\{(#s\d+b\d+(?:\s[^}]*)?)\}\s*$`: the text runs to the last `]{` whose attributes
/// start with a block id and hold no `}`.
fn block_span(line: &str) -> Option<(&str, Attrs)> {
    let body = line.trim_end().strip_prefix('[')?.strip_suffix('}')?;
    let mut end = body.len();
    while let Some(at) = body[..end].rfind("]{") {
        let attrs = &body[at + 2..];
        if !attrs.contains('}') && starts_with_block_id(attrs) {
            return Some((&body[..at], parse_attrs(attrs)));
        }
        end = at;
    }
    None
}

/// Whether `attrs` starts with `#s<digits>b<digits>`, then ends or goes on after whitespace.
fn starts_with_block_id(attrs: &str) -> bool {
    let Some(rest) = attrs.strip_prefix('#') else { return false };
    let token = rest.split(char::is_whitespace).next().unwrap_or_default();
    let after = &rest[token.len()..];
    slide_of(token).is_some() && (after.is_empty() || after.starts_with(char::is_whitespace))
}

/// The slide part of a block id: `s3` for `s3b1`; `None` unless `id` is `s\d+b\d+`.
fn slide_of(id: &str) -> Option<&str> {
    let rest = id.strip_prefix('s')?;
    let (slide, block) = rest.split_once('b')?;
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    (digits(slide) && digits(block)).then(|| &id[..=slide.len()])
}

/// Parses the inside of `{…}`: `#id`, `.class`, `key=value` and `key="value"`. Anything else is
/// skipped, as the buffer's `parseAttrs` does. Unlike it, a second `#id` doesn't replace the first.
fn parse_attrs(inner: &str) -> Attrs {
    let mut attrs = Attrs::default();
    let mut rest = inner;
    let word_end = |s: &str, stop: &[char]| s.find(|c: char| c.is_whitespace() || stop.contains(&c)).unwrap_or(s.len());
    while let Some(c) = rest.chars().next() {
        if c.is_whitespace() {
            rest = &rest[c.len_utf8()..];
        } else if let Some(r) = rest.strip_prefix('#') {
            let n = word_end(r, &['}']);
            // The first id counts: a block span's is the one `block_span` checked.
            if n > 0 && attrs.id.is_empty() {
                attrs.id = r[..n].to_owned();
            }
            rest = &r[n..];
        } else if let Some(r) = rest.strip_prefix('.') {
            let n = word_end(r, &['}', '=']);
            if n > 0 {
                attrs.classes.push(r[..n].to_owned());
            }
            rest = &r[n..];
        } else {
            let n = rest.find(|c: char| !(c.is_alphanumeric() || c == '_' || c == '-')).unwrap_or(rest.len());
            match rest[n..].strip_prefix('=') {
                Some(v) if n > 0 => {
                    let key = rest[..n].to_owned();
                    let (value, after) = match v.strip_prefix('"') {
                        Some(q) => match q.find('"') {
                            Some(close) => (&q[..close], &q[close + 1..]),
                            None => (q, ""),
                        },
                        None => {
                            let m = word_end(v, &['}']);
                            (&v[..m], &v[m..])
                        }
                    };
                    attrs.values.push((key, value.to_owned()));
                    rest = after;
                }
                // Not an attribute: skip one character, as a regex scan would.
                _ => rest = &rest[c.len_utf8()..],
            }
        }
    }
    attrs
}

#[cfg(test)]
mod tests;
