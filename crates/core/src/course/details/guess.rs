//! The form's first values, guessed from folder names: the course folder's own name gives the
//! name, code and term (`STAT311 - Probability and Statistics (Fall 2026)`), its subfolders give
//! the folder mapping (`Slides/` if that is how the course spells it), and the icon is the first
//! letter of the code or name.

use std::ops::Range;
use std::path::Path;

use super::{CourseDetails, CourseFolders};
use crate::course::MAX_ENTRIES;
use crate::error::{Error, Result};

/// The colour a course starts with: the spec's example, the default accent (`accent-bg`).
pub(crate) const DEFAULT_COLOR: &str = "#3584e4";

/// The folder names each mapping looks for in a new course, the spec's own first.
const SLIDES: &[&str] = &["slides"];
const SOURCES: &[&str] = &["sources"];
const LECTURES: &[&str] = &["lectures"];
const PAST_PAPERS: &[&str] = &["past-papers", "past papers", "past_papers", "pastpapers", "past-exams", "exams"];

/// The details guessed for the canonical course folder `root`.
pub(super) fn from_names(root: &Path) -> Result<CourseDetails> {
    let folder = root.file_name().map_or(Some(""), |n| n.to_str()).ok_or(Error::NotUnicode)?;
    let parsed = parse(folder);
    let sources = find(root, SOURCES).unwrap_or_else(|| SOURCES[0].to_owned());
    let past = find(&root.join(&sources), PAST_PAPERS).unwrap_or_else(|| PAST_PAPERS[0].to_owned());
    let folders = CourseFolders {
        slides: find(root, SLIDES).unwrap_or_else(|| SLIDES[0].to_owned()),
        lectures: find(root, LECTURES).unwrap_or_else(|| LECTURES[0].to_owned()),
        past_papers: format!("{sources}/{past}"),
        sources,
    };
    Ok(CourseDetails {
        icon: icon(&parsed.code, &parsed.name),
        name: parsed.name,
        code: parsed.code,
        term: parsed.term,
        professor: String::new(),
        color: DEFAULT_COLOR.to_owned(),
        folders,
    })
}

/// What a course folder's name says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Parsed {
    pub name: String,
    pub code: String,
    pub term: String,
}

/// Splits a folder name into the course's name, code (`STAT 311`) and term (`Fall 2026`). What is
/// left once the code and term are taken out is the name; if nothing is, the folder name is.
pub(super) fn parse(folder: &str) -> Parsed {
    let words = words(folder);
    let mut taken: Vec<Range<usize>> = Vec::new();
    let code = code(folder, &words).map(|(span, code)| {
        taken.push(span);
        code
    });
    let term = term(folder, &words).map(|(span, term)| {
        taken.push(span);
        term
    });
    let mut rest = String::with_capacity(folder.len());
    for (i, c) in folder.char_indices() {
        if !taken.iter().any(|r| r.contains(&i)) {
            rest.push(if c == '_' { ' ' } else { c });
        }
    }
    let name = tidy(&rest);
    Parsed {
        name: if name.is_empty() { tidy(&folder.replace('_', " ")) } else { name },
        code: code.unwrap_or_default(),
        term: term.unwrap_or_default(),
    }
}

/// The runs of ASCII letters and digits in `s`, by byte range.
fn words(s: &str) -> Vec<Range<usize>> {
    let mut out = Vec::new();
    let mut start = None;
    for (i, c) in s.char_indices().chain(std::iter::once((s.len(), ' '))) {
        match (c.is_ascii_alphanumeric(), start) {
            (true, None) => start = Some(i),
            (false, Some(from)) => {
                out.push(from..i);
                start = None;
            }
            _ => {}
        }
    }
    out
}

/// Whether only spaces or hyphens (at most one character in all) sit between two words.
fn adjacent(s: &str, a: &Range<usize>, b: &Range<usize>) -> bool {
    let gap = &s[a.end..b.start];
    gap.chars().count() <= 1 && gap.chars().all(|c| c == ' ' || c == '-' || c == '_')
}

/// The first course code: 2–6 capital letters and 2–4 digits with an optional letter, written
/// together (`STAT311`) or apart (`STAT 311`, `CS-101`), shown as `STAT 311`.
fn code(s: &str, words: &[Range<usize>]) -> Option<(Range<usize>, String)> {
    let letters = |w: &str| (2..=6).contains(&w.len()) && w.bytes().all(|b| b.is_ascii_uppercase());
    let number = |w: &str| {
        let digits = w.bytes().take_while(u8::is_ascii_digit).count();
        let tail = &w.as_bytes()[digits..];
        (2..=4).contains(&digits) && (tail.is_empty() || (tail.len() == 1 && tail[0].is_ascii_alphabetic()))
    };
    for (i, w) in words.iter().enumerate() {
        let word = &s[w.clone()];
        let split = word.bytes().take_while(u8::is_ascii_uppercase).count();
        // `letters` needs 2+ letters and `number` 2+ digits, so neither part can be empty.
        if letters(&word[..split]) && number(&word[split..]) {
            return Some((w.clone(), format!("{} {}", &word[..split], word[split..].to_ascii_uppercase())));
        }
        if let Some(next) = words.get(i + 1)
            && letters(word)
            && number(&s[next.clone()])
            && adjacent(s, w, next)
        {
            return Some((w.start..next.end, format!("{word} {}", s[next.clone()].to_ascii_uppercase())));
        }
    }
    None
}

/// The first term: a season and a year (`Fall 2026`, `fall_2026`, `Spring2025`), shown as
/// `Fall 2026`.
fn term(s: &str, words: &[Range<usize>]) -> Option<(Range<usize>, String)> {
    const SEASONS: [&str; 5] = ["Fall", "Autumn", "Spring", "Summer", "Winter"];
    let season = |w: &str| SEASONS.iter().find(|x| x.eq_ignore_ascii_case(w)).copied();
    let year =
        |w: &str| w.len() == 4 && w.bytes().all(|b| b.is_ascii_digit()) && (w.starts_with("19") || w.starts_with("20"));
    for (i, w) in words.iter().enumerate() {
        let word = &s[w.clone()];
        // A season with no letters is no season, so `Fall2026` needs more than the year.
        if let Some(at) = word.len().checked_sub(4)
            && let Some((head, tail)) = word.split_at_checked(at)
            && let Some(x) = season(head)
            && year(tail)
        {
            return Some((w.clone(), format!("{x} {tail}")));
        }
        if let (Some(x), Some(next)) = (season(word), words.get(i + 1))
            && year(&s[next.clone()])
            && adjacent(s, w, next)
        {
            return Some((w.start..next.end, format!("{x} {}", &s[next.clone()])));
        }
    }
    None
}

/// `rest` without empty brackets, separators at either end, or runs of spaces.
fn tidy(rest: &str) -> String {
    let mut s = rest.to_owned();
    for empty in ["()", "[]", "( )", "[ ]"] {
        s = s.replace(empty, " ");
    }
    let collapsed = s.split_whitespace().collect::<Vec<_>>().join(" ");
    let edge = |c: char| c.is_whitespace() || matches!(c, '-' | '–' | '—' | ':' | ',' | '.' | '|' | '/');
    let trimmed = collapsed.trim_matches(edge);
    // A separator left between two removed parts (`STAT311 - - Fall 2026`) reads as one.
    trimmed.replace(" - - ", " - ")
}

/// The icon: the first letter or digit of the code, else of the name, in capitals.
fn icon(code: &str, name: &str) -> String {
    code.chars()
        .chain(name.chars())
        .find(|c| c.is_alphanumeric())
        .map_or_else(|| "C".to_owned(), |c| c.to_uppercase().collect())
}

/// The name of a real folder (not a link) directly in `dir` that matches one of `names`, ignoring
/// ASCII case; an exact match wins. Looks at most [`MAX_ENTRIES`] entries.
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
fn find(dir: &Path, names: &[&str]) -> Option<String> {
    let mut found: Option<(usize, String)> = None;
    for entry in std::fs::read_dir(dir).ok()?.take(MAX_ENTRIES).flatten() {
        if !entry.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let Ok(name) = entry.file_name().into_string() else { continue };
        let Some(rank) = names.iter().position(|n| n.eq_ignore_ascii_case(&name)) else { continue };
        // Exact spellings rank before case variants; earlier names before later ones.
        let rank = rank * 2 + usize::from(names[rank] != name);
        if found.as_ref().is_none_or(|(best, kept)| rank < *best || (rank == *best && name < *kept)) {
            found = Some((rank, name));
        }
    }
    found.map(|(_, name)| name)
}
