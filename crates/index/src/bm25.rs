//! A course's BM25 index (`05-retrieval.md#search`): Tantivy, in `<course>/.lecter/cache/index`
//! (`02-course-folder.md`: the cache folder holds the index and is safe to delete). Lecture slide
//! blocks go in one document each, with the spec's fields `text`, `breadcrumb`, `tags`, `kind`,
//! `source` and `lecture`, plus the `slide` and `block` ids a hit points at.
//!
//! The folder is a cache: an index Tantivy can't open, or one written with another schema, is
//! dropped and rebuilt empty, and lectures are indexed again as they are opened. Readers reload
//! only after this process commits (no file watcher, no polling).
//!
//! Everything here blocks on the file system: async callers run it in `spawn_blocking`.

use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use serde::Serialize;
use tantivy::collector::TopDocs;
use tantivy::directory::MmapDirectory;
use tantivy::query::{BooleanQuery, BoostQuery, Occur, Query, TermQuery};
use tantivy::schema::{Field, IndexRecordOption, STORED, STRING, Schema, TEXT, Value};
use tantivy::{Index, IndexReader, IndexSettings, ReloadPolicy, TantivyDocument, Term, doc};

use crate::blocks::{Block, lecture_blocks};
use crate::error::{Error, Result};

/// Where a course keeps its BM25 index, relative to the course root.
pub const INDEX_DIR: &str = ".lecter/cache/index";

/// The `kind` of a lecture slide block (05-retrieval.md#indexing: "Slides").
pub const KIND_SLIDES: &str = "slides";

/// The most hits one `:find` lists (`search_find` and `lecter-harness search`): a screenful of
/// blocks; more words narrow it.
pub const MAX_HITS: usize = 50;

/// The tag a flagged block carries in `tags`.
pub const TAG_FLAG: &str = "flag";

/// The writer's indexing memory for its one thread: Tantivy's minimum (its private
/// `MEMORY_BUDGET_NUM_BYTES_MIN`, 15 MB). A lecture is a few hundred short blocks, far below it;
/// the writer lives only while one lecture is written.
const WRITER_MEMORY: usize = 15_000_000;

/// The most distinct query words searched; the rest are ignored. A 1 KB query (the IPC limit)
/// has at most a few hundred, and BM25 gains nothing from more.
const MAX_QUERY_TERMS: usize = 64;

/// How much a word in the breadcrumb counts next to one in the block's text.
const BREADCRUMB_BOOST: f32 = 0.5;

/// One search hit: a block, where it is, and its BM25 score.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Hit {
    /// The lecture file, course-relative: `lectures/l07.md`.
    pub lecture: String,
    /// The slide id, e.g. `s3`.
    pub slide: String,
    /// The block id, e.g. `s3b1`.
    pub block: String,
    /// The block's text.
    pub text: String,
    /// Lecture title › slide title.
    pub breadcrumb: String,
    /// The BM25 score; hits come highest first.
    pub score: f32,
}

#[derive(Debug, Clone, Copy)]
struct Fields {
    lecture: Field,
    slide: Field,
    block: Field,
    text: Field,
    breadcrumb: Field,
    tags: Field,
    kind: Field,
    source: Field,
}

impl Fields {
    fn schema() -> (Schema, Self) {
        let mut b = Schema::builder();
        let fields = Self {
            lecture: b.add_text_field("lecture", STRING | STORED),
            slide: b.add_text_field("slide", STRING | STORED),
            block: b.add_text_field("block", STRING | STORED),
            text: b.add_text_field("text", TEXT | STORED),
            breadcrumb: b.add_text_field("breadcrumb", TEXT | STORED),
            tags: b.add_text_field("tags", STRING | STORED),
            kind: b.add_text_field("kind", STRING | STORED),
            source: b.add_text_field("source", STRING | STORED),
        };
        (b.build(), fields)
    }
}

/// One course's BM25 index. `Sync`: searches run in parallel; writes take turns.
pub struct CourseIndex {
    dir: PathBuf,
    index: Index,
    reader: IndexReader,
    fields: Fields,
    /// A fingerprint of each lecture's text as last written, so an unchanged lecture isn't
    /// written again. Held while writing, so writes take turns.
    written: Mutex<HashMap<String, u64>>,
}

impl std::fmt::Debug for CourseIndex {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CourseIndex").field("dir", &self.dir).finish_non_exhaustive()
    }
}

impl CourseIndex {
    /// Opens the index of the course folder `course` (absolute), creating `.lecter/cache/index`
    /// if needed. A `.lecter` or cache link out of the course is refused (SEC-35).
    pub fn open(course: &Path) -> Result<Self> {
        let dir = lecter_core::course::ensure_dir(course, INDEX_DIR)?;
        let (schema, fields) = Fields::schema();
        let index = match open_dir(&dir).and_then(|d| Ok(Index::open_or_create(d, schema.clone())?)) {
            Ok(index) => index,
            Err(Error::Locked) => return Err(Error::Locked),
            // Unreadable, or another schema: the cache is rebuilt (Index::create erases it).
            Err(_) => Index::create(open_dir(&dir)?, schema, IndexSettings::default())?,
        };
        let reader = index.reader_builder().reload_policy(ReloadPolicy::Manual).try_into()?;
        Ok(Self { dir, index, reader, fields, written: Mutex::new(HashMap::new()) })
    }

    /// The folder the index lives in (canonical).
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Indexes the slide blocks of the lecture `lecture` (course-relative path) whose whole file is
    /// `text`, replacing what was indexed for it before. Returns how many blocks it holds, or
    /// `None` when `text` is what this index last wrote for it (nothing is written).
    pub fn index_lecture(&self, lecture: &str, text: &str) -> Result<Option<usize>> {
        let mut written = self.written.lock().unwrap_or_else(PoisonError::into_inner);
        let print = fingerprint(text);
        if written.get(lecture) == Some(&print) {
            return Ok(None);
        }
        let blocks = lecture_blocks(text);
        self.replace(lecture, &blocks)?;
        written.insert(lecture.to_owned(), print);
        Ok(Some(blocks.len()))
    }

    /// Removes everything indexed for `lecture`: a lecture file that no longer exists.
    pub fn forget_lecture(&self, lecture: &str) -> Result<()> {
        let mut written = self.written.lock().unwrap_or_else(PoisonError::into_inner);
        self.replace(lecture, &[])?;
        written.remove(lecture);
        Ok(())
    }

    /// Replaces `lecture`'s documents with `blocks`, commits and reloads the reader. The caller
    /// holds the `written` lock, so writers take turns in this process.
    fn replace(&self, lecture: &str, blocks: &[Block]) -> Result<()> {
        let f = self.fields;
        let mut writer = self.index.writer_with_num_threads::<TantivyDocument>(1, WRITER_MEMORY)?;
        writer.delete_term(Term::from_field_text(f.lecture, lecture));
        for b in blocks {
            let mut d = doc!(
                f.lecture => lecture,
                f.slide => b.slide.as_str(),
                f.block => b.block.as_str(),
                f.text => b.text.as_str(),
                f.breadcrumb => b.breadcrumb.as_str(),
                f.kind => KIND_SLIDES,
                f.source => b.source.as_str(),
            );
            if b.flagged {
                d.add_text(f.tags, TAG_FLAG);
            }
            writer.add_document(d)?;
        }
        writer.commit()?;
        writer.wait_merging_threads()?;
        self.reader.reload()?;
        Ok(())
    }

    /// Drops the hits of lectures that are no longer files in the course folder `course` (deleted
    /// or renamed since they were indexed) and forgets those lectures' entries. The index is a
    /// file in the course folder, so a lecture path that isn't `lectures/<name>` counts as gone
    /// and is never looked up outside the course (SEC-35).
    pub fn drop_missing(&self, course: &Path, hits: &mut Vec<Hit>) -> Result<()> {
        let mut gone: Vec<String> = Vec::new();
        for hit in hits.iter() {
            if !gone.contains(&hit.lecture) && !(lecture_path(&hit.lecture) && is_file(&course.join(&hit.lecture))) {
                gone.push(hit.lecture.clone());
            }
        }
        for lecture in &gone {
            self.forget_lecture(lecture)?;
        }
        hits.retain(|h| !gone.contains(&h.lecture));
        Ok(())
    }

    /// The `limit` best blocks for the words of `query`, highest BM25 score first. Words are
    /// split and lower-cased as the text was; any of them matching makes a hit. A query with no
    /// words, or a `limit` of 0, finds nothing.
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<Hit>> {
        let Some(query) = self.words_query(query)? else { return Ok(Vec::new()) };
        if limit == 0 {
            return Ok(Vec::new());
        }
        let searcher = self.reader.searcher();
        let top = searcher.search(&query, &TopDocs::with_limit(limit).order_by_score())?;
        let mut hits = Vec::with_capacity(top.len());
        for (score, address) in top {
            let d: TantivyDocument = searcher.doc(address)?;
            let get = |field| d.get_first(field).and_then(|v| v.as_str()).unwrap_or_default().to_owned();
            let f = self.fields;
            hits.push(Hit {
                lecture: get(f.lecture),
                slide: get(f.slide),
                block: get(f.block),
                text: get(f.text),
                breadcrumb: get(f.breadcrumb),
                score,
            });
        }
        Ok(hits)
    }

    /// A query matching any word of `query` in the text or (boosted lower) the breadcrumb;
    /// `None` when it has no words.
    fn words_query(&self, query: &str) -> Result<Option<Box<dyn Query>>> {
        let mut analyzer = self.index.tokenizer_for_field(self.fields.text)?;
        let mut words: Vec<String> = Vec::new();
        let mut stream = analyzer.token_stream(query);
        while words.len() < MAX_QUERY_TERMS && stream.advance() {
            let word = &stream.token().text;
            if !words.contains(word) {
                words.push(word.clone());
            }
        }
        if words.is_empty() {
            return Ok(None);
        }
        let term = |field, word: &str| -> Box<dyn Query> {
            Box::new(TermQuery::new(Term::from_field_text(field, word), IndexRecordOption::WithFreqs))
        };
        let mut clauses: Vec<(Occur, Box<dyn Query>)> = Vec::with_capacity(words.len() * 2);
        for w in &words {
            clauses.push((Occur::Should, term(self.fields.text, w)));
            clauses.push((Occur::Should, Box::new(BoostQuery::new(term(self.fields.breadcrumb, w), BREADCRUMB_BOOST))));
        }
        Ok(Some(Box::new(BooleanQuery::new(clauses))))
    }
}

fn open_dir(dir: &Path) -> Result<MmapDirectory> {
    MmapDirectory::open(dir).map_err(|e| Error::Index(e.to_string()))
}

/// Whether `rel` has a lecture path's shape: `lectures/` and one name, with no separator, drive or
/// NUL that could lead out of the folder. (`lectures/`, `lectures/.` and `lectures/..` pass, but
/// they are folders, which the file check refuses.)
fn lecture_path(rel: &str) -> bool {
    rel.strip_prefix("lectures/").is_some_and(|name| !name.contains(['/', '\\', ':', '\0']))
}

/// Whether `path` is a regular file now.
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
fn is_file(path: &Path) -> bool {
    std::fs::metadata(path).is_ok_and(|m| m.is_file())
}

fn fingerprint(text: &str) -> u64 {
    let mut h = DefaultHasher::new();
    text.hash(&mut h);
    h.finish()
}

#[cfg(test)]
mod tests;
