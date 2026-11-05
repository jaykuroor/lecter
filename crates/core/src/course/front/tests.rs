//! D-194: the lecture date the sidebar shows, from front matter (03-lecture-files.md#front-matter),
//! read from at most the first 4 KB and parsed defensively (13-security.md).

#![allow(clippy::disallowed_methods, reason = "tests build fixture files on plain test threads")]

use super::*;
use crate::testenv::TestEnv;

fn date(text: &str) -> Option<String> {
    date_in(text.as_bytes(), true)
}

const SPEC_EXAMPLE: &str = "---\nlecter: 1\nlecture: 7\ndate: 2026-10-23\ntitle: Covariance and Correlation\nslides:\n  - slides/07-covariance.pdf\n  - slides/07b-examples.pptx\n---\n\n::: {.slide #s1 n=1}\n:::\n";

#[test]
fn the_spec_examples_date_is_read() {
    assert_eq!(date(SPEC_EXAMPLE), Some("2026-10-23".to_owned()));
}

#[test]
fn crlf_lines_and_a_byte_order_mark_are_read_too() {
    assert_eq!(date("---\r\nlecter: 1\r\ndate: 2026-10-23\r\n---\r\n"), Some("2026-10-23".to_owned()));
    assert_eq!(date("\u{feff}---\ndate: 2026-10-23\n---\n"), Some("2026-10-23".to_owned()));
}

#[test]
fn only_front_matter_counts() {
    // No front matter: a body that mentions a date has none.
    assert_eq!(date("date: 2026-10-23\n"), None);
    assert_eq!(date("\n---\ndate: 2026-10-23\n---\n"), None);
    assert_eq!(date(" ---\ndate: 2026-10-23\n---\n"), None);
    // After the closing line, it's the body.
    assert_eq!(date("---\nlecter: 1\n---\ndate: 2026-10-23\n"), None);
    assert_eq!(date("---\nlecter: 1\n...\ndate: 2026-10-23\n"), None);
    assert_eq!(date(""), None);
    assert_eq!(date("---"), None);
}

#[test]
fn only_a_top_level_date_key_counts() {
    assert_eq!(date("---\nmeta:\n  date: 2026-10-23\n---\n"), None);
    assert_eq!(date("---\nupdate: 2026-10-23\n---\n"), None);
    assert_eq!(date("---\ndates: 2026-10-23\n---\n"), None);
    assert_eq!(date("---\ndate : 2026-10-23\n---\n"), None);
    // The first one wins.
    assert_eq!(date("---\ndate: 2026-10-23\ndate: 2026-10-30\n---\n"), Some("2026-10-23".to_owned()));
    assert_eq!(date("---\ndate: soon\ndate: 2026-10-30\n---\n"), None);
}

#[test]
fn quotes_spaces_and_a_comment_may_surround_the_date() {
    for line in [
        "date:2026-10-23",
        "date:   2026-10-23   ",
        "date:\t2026-10-23",
        "date: \"2026-10-23\"",
        "date: '2026-10-23'",
        "date: 2026-10-23 # moved from Thursday",
        "date: '2026-10-23'\t# moved",
        "date: 2026-10-23 #moved",
    ] {
        assert_eq!(date(&format!("---\n{line}\n---\n")), Some("2026-10-23".to_owned()), "{line}");
    }
}

#[test]
fn anything_not_shaped_like_yyyy_mm_dd_is_no_date() {
    for line in [
        "date:",
        "date: ",
        "date: 2026-1-23",
        "date: 2026/10/23",
        "date: 20261023",
        "date: 2026-10-23T10:00",
        "date: 2026-10-233",
        "date: x2026-10-23",
        "date: 2026-10-2x",
        "date: 2026-10_23",
        "date: 2026_10-23",
        "date: \"2026-10-23'",
        "date: \"2026-10-23",
        "date: 2026-10-23#no space before the hash",
        "date: 2026-10-23# x",
        "date:#2026-10-23",
        "date: # 2026-10-23",
        "date: ２０２６-10-23",
    ] {
        assert_eq!(date(&format!("---\n{line}\n---\n")), None, "{line}");
    }
}

#[test]
fn a_line_cut_off_by_the_limit_is_not_read() {
    // The limit fell inside the line: `2026-10-2` might have gone on to `2026-10-29`.
    assert_eq!(date_in(b"---\nlecter: 1\ndate: 2026-10-23", false), None);
    assert_eq!(date_in(b"---\nlecter: 1\ndate: 2026-10-23\n", false), Some("2026-10-23".to_owned()));
    // The whole file, ending without a newline.
    assert_eq!(date_in(b"---\nlecter: 1\ndate: 2026-10-23", true), Some("2026-10-23".to_owned()));
    // The first line itself cut off.
    assert_eq!(date_in(b"---", false), None);
}

#[test]
fn bytes_that_are_not_utf8_elsewhere_do_not_hide_the_date() {
    assert_eq!(date_in(b"---\ntitle: \xff\xfe\ndate: 2026-10-23\n---\n", true), Some("2026-10-23".to_owned()));
}

fn env() -> TestEnv {
    TestEnv::new().unwrap_or_else(|e| panic!("{e}"))
}

#[test]
fn a_lecture_file_is_read_for_its_date() {
    let env = env();
    let path = env.home().join("l07.md");
    std::fs::write(&path, SPEC_EXAMPLE).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(lecture_date(&path), Some("2026-10-23".to_owned()));
}

#[test]
fn a_short_file_ending_without_a_newline_is_read_whole() {
    let env = env();
    let path = env.home().join("short.md");
    std::fs::write(&path, "---\ndate: 2026-10-23").unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(lecture_date(&path), Some("2026-10-23".to_owned()));
}

#[test]
fn only_the_first_4_kb_are_read() {
    let env = env();
    let pad = |n: usize| format!("---\nnote: {}\n", "x".repeat(n));
    // `note: ` + n x's + newline, after the 4-byte first line: the date line starts at byte 4 + 7 + n.
    let fits = env.home().join("fits.md");
    let start = 4096 - "date: 2026-10-23\n".len() - 11;
    std::fs::write(&fits, format!("{}date: 2026-10-23\n---\n", pad(start))).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(lecture_date(&fits), Some("2026-10-23".to_owned()));
    // One byte more and its newline falls past the limit.
    let past = env.home().join("past.md");
    std::fs::write(&past, format!("{}date: 2026-10-23\n---\n", pad(start + 1))).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(lecture_date(&past), None);
}

#[test]
fn what_is_not_a_readable_file_has_no_date() {
    let env = env();
    assert_eq!(lecture_date(&env.home().join("gone.md")), None);
    let folder = env.home().join("folder.md");
    std::fs::create_dir_all(&folder).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(lecture_date(&folder), None);
}
