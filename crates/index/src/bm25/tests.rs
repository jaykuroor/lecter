#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::path::PathBuf;

use lecter_core::ErrorCode;
use lecter_core::testenv::TestEnv;

use super::*;

const L07: &str = "lectures/l07.md";
const L08: &str = "lectures/l08.md";

/// A synthetic lecture as Lecter writes it (03-lecture-files.md#body). English only.
const SEVEN: &str = r#"---
lecter: 1
lecture: 7
title: Covariance and Correlation
---

::: {.slide #s1 n=1 src="A1" title="Covariance"}
## Covariance

[Covariance measures how two variables move together.]{#s1b1}

[It is zero for independent variables.]{#s1b2}
:::

::: {.slide #s2 n=2 src="A2" title="Properties"}
## Properties

[Covariance is bilinear in each argument.]{#s2b1}

[Variance of a sum adds twice the covariance.]{#s2b2 .flag}
:::
"#;

const EIGHT: &str = r#"---
title: Regression
---

::: {.slide #s1 n=1 src="A1" title="Least squares"}
[The slope is the covariance over the variance of x.]{#s1b1}

[Residuals sum to zero.]{#s1b2}
:::
"#;

fn course(env: &TestEnv) -> PathBuf {
    let dir = env.home().join("STAT311");
    std::fs::create_dir_all(dir.join("lectures")).unwrap();
    dir
}

/// The (lecture, block) of each hit, in rank order.
fn ids(hits: &[Hit]) -> Vec<(&str, &str)> {
    hits.iter().map(|h| (h.lecture.as_str(), h.block.as_str())).collect()
}

/// The id and filter fields of one stored block.
#[derive(Debug, PartialEq, Eq)]
struct Stored {
    lecture: String,
    slide: String,
    block: String,
    tags: Vec<String>,
    kind: String,
    source: String,
}

/// Every block stored for `lecture`, by block id: what was written, read back from Tantivy.
fn stored(index: &CourseIndex, lecture: &str) -> Vec<Stored> {
    let searcher = index.reader.searcher();
    let q = TermQuery::new(Term::from_field_text(index.fields.lecture, lecture), IndexRecordOption::Basic);
    let top = searcher.search(&q, &TopDocs::with_limit(1000).order_by_score()).unwrap();
    let f = index.fields;
    let mut out: Vec<Stored> = top
        .into_iter()
        .map(|(_, address)| {
            let d: TantivyDocument = searcher.doc(address).unwrap();
            let all = |field| d.get_all(field).filter_map(|v| v.as_str().map(str::to_owned)).collect::<Vec<_>>();
            let one = |field| all(field).join("|");
            Stored {
                lecture: one(f.lecture),
                slide: one(f.slide),
                block: one(f.block),
                tags: all(f.tags),
                kind: one(f.kind),
                source: one(f.source),
            }
        })
        .collect();
    out.sort_by(|a, b| a.block.cmp(&b.block));
    out
}

fn row(lecture: &str, slide: &str, block: &str, flagged: bool, source: &str) -> Stored {
    Stored {
        lecture: lecture.into(),
        slide: slide.into(),
        block: block.into(),
        tags: if flagged { vec!["flag".into()] } else { vec![] },
        kind: "slides".into(),
        source: source.into(),
    }
}

/// F-022 criterion 1: each block is a document with its lecture, slide and block ids (and the
/// spec's kind, tags and source).
#[test]
fn a_lecture_is_indexed_block_by_block_with_lecture_slide_and_block_ids() {
    let env = TestEnv::new().unwrap();
    let index = CourseIndex::open(&course(&env)).unwrap();
    assert_eq!(index.index_lecture(L07, SEVEN).unwrap(), Some(4));
    assert_eq!(
        stored(&index, L07),
        [
            row(L07, "s1", "s1b1", false, "A1"),
            row(L07, "s1", "s1b2", false, "A1"),
            row(L07, "s2", "s2b1", false, "A2"),
            row(L07, "s2", "s2b2", true, "A2"),
        ]
    );
    let dir = std::fs::canonicalize(env.home().join("STAT311/.lecter/cache/index")).unwrap();
    assert_eq!(index.dir(), dir);
    assert!(dir.join("meta.json").is_file(), "the index is on disk");
    // Debug shows where the index is, and nothing indexed.
    assert_eq!(format!("{index:?}"), format!("CourseIndex {{ dir: {dir:?}, .. }}"));
}

#[test]
fn search_ranks_blocks_by_bm25_with_their_ids_and_text() {
    let env = TestEnv::new().unwrap();
    let index = CourseIndex::open(&course(&env)).unwrap();
    index.index_lecture(L07, SEVEN).unwrap();
    index.index_lecture(L08, EIGHT).unwrap();

    // "zero" is in two blocks; the shorter block ranks first (BM25 length normalisation).
    let hits = index.search("zero", 10).unwrap();
    assert_eq!(ids(&hits), [(L08, "s1b2"), (L07, "s1b2")]);
    assert_eq!(hits[0].text, "Residuals sum to zero.");
    assert_eq!(hits[0].slide, "s1");
    assert_eq!(hits[0].breadcrumb, "Regression › Least squares");
    assert!(hits[0].score > hits[1].score && hits[1].score > 0.0, "{hits:?}");

    // A block matching both words outranks blocks matching one; case doesn't matter.
    let hits = index.search("RESIDUALS Zero", 10).unwrap();
    assert_eq!(ids(&hits)[0], (L08, "s1b2"));
    assert_eq!(hits.len(), 2);

    assert!(index.search("eigenvalue", 10).unwrap().is_empty());
}

#[test]
fn a_breadcrumb_word_finds_the_slides_blocks_below_text_matches() {
    let env = TestEnv::new().unwrap();
    let index = CourseIndex::open(&course(&env)).unwrap();
    index.index_lecture(L07, SEVEN).unwrap();
    // "properties" is only in slide 2's title, so it finds both its blocks.
    let hits = index.search("properties", 10).unwrap();
    assert_eq!(ids(&hits).len(), 2);
    assert!(hits.iter().all(|h| h.slide == "s2"), "{hits:?}");
    // A text word and a breadcrumb word together rank the block with both first.
    let hits = index.search("bilinear properties", 10).unwrap();
    assert_eq!(ids(&hits)[0], (L07, "s2b1"));
}

#[test]
fn limit_caps_the_hits_and_empty_queries_find_nothing() {
    let env = TestEnv::new().unwrap();
    let index = CourseIndex::open(&course(&env)).unwrap();
    index.index_lecture(L07, SEVEN).unwrap();
    assert_eq!(index.search("covariance", 10).unwrap().len(), 4);
    assert_eq!(index.search("covariance", 2).unwrap().len(), 2);
    assert_eq!(index.search("covariance", 1).unwrap().len(), 1);
    assert!(index.search("covariance", 0).unwrap().is_empty());
    for nothing in ["", "   ", "?! — …", ":::"] {
        assert!(index.search(nothing, 10).unwrap().is_empty(), "{nothing:?}");
    }
}

#[test]
fn query_words_are_capped() {
    let env = TestEnv::new().unwrap();
    let index = CourseIndex::open(&course(&env)).unwrap();
    index.index_lecture(L08, EIGHT).unwrap();
    // 64 filler words first: "residuals" is the 65th distinct word and is not searched.
    let filler: Vec<String> = (0..MAX_QUERY_TERMS).map(|i| format!("w{i}")).collect();
    let past = format!("{} residuals", filler.join(" "));
    assert!(index.search(&past, 10).unwrap().is_empty());
    // Repeats count once, so the same word repeated stays within the cap.
    let repeated = format!("{} residuals", vec!["w0"; 200].join(" "));
    assert_eq!(ids(&index.search(&repeated, 10).unwrap()), [(L08, "s1b2")]);
}

#[test]
fn indexing_a_lecture_again_replaces_its_blocks_and_leaves_others() {
    let env = TestEnv::new().unwrap();
    let index = CourseIndex::open(&course(&env)).unwrap();
    index.index_lecture(L07, SEVEN).unwrap();
    index.index_lecture(L08, EIGHT).unwrap();
    let edited = SEVEN.replace("bilinear", "symmetric");
    assert_eq!(index.index_lecture(L07, &edited).unwrap(), Some(4));
    assert!(index.search("bilinear", 10).unwrap().is_empty());
    assert_eq!(ids(&index.search("symmetric", 10).unwrap()), [(L07, "s2b1")]);
    assert_eq!(stored(&index, L07).len(), 4, "the old blocks are gone, not doubled");
    assert_eq!(ids(&index.search("residuals", 10).unwrap()), [(L08, "s1b2")]);
    // A lecture with no blocks left has nothing indexed.
    assert_eq!(index.index_lecture(L08, "---\ntitle: x\n---\n").unwrap(), Some(0));
    assert!(stored(&index, L08).is_empty());
}

#[test]
fn unchanged_text_is_not_written_again() {
    let env = TestEnv::new().unwrap();
    let index = CourseIndex::open(&course(&env)).unwrap();
    assert_eq!(index.index_lecture(L07, SEVEN).unwrap(), Some(4));
    assert_eq!(index.index_lecture(L07, SEVEN).unwrap(), None);
    // The fingerprint is per lecture: the same text under another path is written.
    assert_eq!(index.index_lecture(L08, SEVEN).unwrap(), Some(4));
    assert_eq!(index.index_lecture(L07, EIGHT).unwrap(), Some(2));
}

#[test]
fn the_index_survives_a_reopen() {
    let env = TestEnv::new().unwrap();
    let dir = course(&env);
    {
        let index = CourseIndex::open(&dir).unwrap();
        index.index_lecture(L07, SEVEN).unwrap();
    }
    let index = CourseIndex::open(&dir).unwrap();
    assert_eq!(ids(&index.search("bilinear", 10).unwrap()), [(L07, "s2b1")]);
}

/// The folder is a cache (02-course-folder.md): one Tantivy can't read is rebuilt, empty.
#[test]
fn an_unreadable_index_is_rebuilt_empty() {
    let env = TestEnv::new().unwrap();
    let dir = course(&env);
    CourseIndex::open(&dir).unwrap().index_lecture(L07, SEVEN).unwrap();
    std::fs::write(dir.join(INDEX_DIR).join("meta.json"), "{ not json").unwrap();
    let index = CourseIndex::open(&dir).unwrap();
    assert!(index.search("bilinear", 10).unwrap().is_empty());
    index.index_lecture(L07, SEVEN).unwrap();
    assert_eq!(ids(&index.search("bilinear", 10).unwrap()), [(L07, "s2b1")]);
}

#[test]
fn an_index_with_another_schema_is_rebuilt_with_ours() {
    let env = TestEnv::new().unwrap();
    let dir = course(&env);
    let cache = lecter_core::course::ensure_dir(&dir, INDEX_DIR).unwrap();
    let mut other = Schema::builder();
    other.add_text_field("body", TEXT);
    Index::create_in_dir(&cache, other.build()).unwrap();
    let index = CourseIndex::open(&dir).unwrap();
    assert_eq!(index.index.schema().get_field("block").ok(), Some(index.fields.block));
    assert!(index.index.schema().get_field("body").is_err());
    index.index_lecture(L07, SEVEN).unwrap();
    assert_eq!(index.search("bilinear", 10).unwrap().len(), 1);
}

/// A second writer (another Lecter process) holding the lock: E_LOCKED, and nothing changes.
#[test]
fn a_busy_index_is_locked() {
    let env = TestEnv::new().unwrap();
    let dir = course(&env);
    let index = CourseIndex::open(&dir).unwrap();
    index.index_lecture(L07, SEVEN).unwrap();
    let other = CourseIndex::open(&dir).unwrap();
    let held = other.index.writer_with_num_threads::<TantivyDocument>(1, WRITER_MEMORY).unwrap();
    let e = index.index_lecture(L07, EIGHT).unwrap_err();
    assert!(matches!(e, Error::Locked), "{e:?}");
    assert_eq!(e.code(), ErrorCode::Locked);
    drop(held);
    // The refused text wasn't remembered as written: it is written once the lock is free.
    assert_eq!(index.index_lecture(L07, EIGHT).unwrap(), Some(2));
}

/// SEC-35: a `.lecter` link out of the course is refused, and nothing is written through it.
#[cfg(unix)]
#[test]
fn a_cache_link_out_of_the_course_is_refused() {
    let env = TestEnv::new().unwrap();
    let dir = course(&env);
    let outside = env.home().join("elsewhere");
    std::fs::create_dir_all(&outside).unwrap();
    std::os::unix::fs::symlink(&outside, dir.join(".lecter")).unwrap();
    let e = CourseIndex::open(&dir).unwrap_err();
    assert_eq!(e.code(), ErrorCode::NotTrusted, "{e:?}");
    assert_eq!(std::fs::read_dir(&outside).unwrap().count(), 0);
}

#[test]
fn a_missing_course_folder_is_not_found() {
    let env = TestEnv::new().unwrap();
    let e = CourseIndex::open(&env.home().join("nope")).unwrap_err();
    assert_eq!(e.code(), ErrorCode::NotFound, "{e:?}");
}

#[test]
fn a_forgotten_lecture_is_gone_and_can_be_indexed_again() {
    let env = TestEnv::new().unwrap();
    let index = CourseIndex::open(&course(&env)).unwrap();
    index.index_lecture(L07, SEVEN).unwrap();
    index.index_lecture(L08, EIGHT).unwrap();
    index.forget_lecture(L08).unwrap();
    assert!(stored(&index, L08).is_empty());
    assert_eq!(ids(&index.search("zero", 10).unwrap()), [(L07, "s1b2")]);
    // Its fingerprint went with it: the same text is written again, not skipped.
    assert_eq!(index.index_lecture(L08, EIGHT).unwrap(), Some(2));
    assert_eq!(stored(&index, L07).len(), 4, "other lectures are untouched");
}

#[test]
fn hits_of_lectures_no_longer_on_disk_are_dropped_and_forgotten() {
    let env = TestEnv::new().unwrap();
    let dir = course(&env);
    std::fs::write(dir.join(L07), SEVEN).unwrap();
    let index = CourseIndex::open(&dir).unwrap();
    index.index_lecture(L07, SEVEN).unwrap();
    index.index_lecture(L08, EIGHT).unwrap();
    let mut hits = index.search("zero", 10).unwrap();
    assert_eq!(hits.len(), 2);
    index.drop_missing(&dir, &mut hits).unwrap();
    assert_eq!(ids(&hits), [(L07, "s1b2")]);
    assert!(stored(&index, L08).is_empty(), "l08 (never written to disk) is forgotten");
    assert_eq!(stored(&index, L07).len(), 4);
    // A folder where the lecture file was is not a lecture either.
    std::fs::remove_file(dir.join(L07)).unwrap();
    std::fs::create_dir(dir.join(L07)).unwrap();
    let mut hits = index.search("zero", 10).unwrap();
    index.drop_missing(&dir, &mut hits).unwrap();
    assert!(hits.is_empty());
}
