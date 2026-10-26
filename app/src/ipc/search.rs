//! The `search` area: `:find` over the blocks of the lectures opened in a course
//! (`05-retrieval.md#search`, F-022). Each course has one Tantivy BM25 index in
//! `.lecter/cache/index` (`lecter_index::CourseIndex`). Opening a lecture indexes it in the
//! background; `search_find` first brings the open lectures' entries up to date with their edits,
//! then searches.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, PoisonError};

use lecter_index::{CourseIndex, Hit, MAX_HITS};
use serde::Serialize;
use specta::Type;
use tauri::State;

use super::error::{ErrorCode, IpcError};
use super::lecture::check_course;
use super::session::{OpenLectures, OpenedCourses};
use super::validate::{self, IpcLimits};

/// One `:find` hit: a block of a lecture. Hits come best BM25 score first; the score itself stays
/// in the core (specta types an `f32` as `number | null`, and the list's order is what the UI shows).
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
pub struct FindHit {
    /// The lecture file, course-relative: `lectures/l07.md`.
    pub lecture: String,
    /// The slide id, e.g. `s3`.
    pub slide: String,
    /// The block id, e.g. `s3b1`.
    pub block: String,
    /// The block's text, as written in the lecture.
    pub text: String,
    /// Lecture title › slide title.
    pub breadcrumb: String,
}

impl From<Hit> for FindHit {
    fn from(h: Hit) -> Self {
        Self { lecture: h.lecture, slide: h.slide, block: h.block, text: h.text, breadcrumb: h.breadcrumb }
    }
}

/// The open search indexes, by course path (as `course_open` returned it). Cloning shares them.
#[derive(Debug, Default, Clone)]
pub struct SearchIndexes(Arc<Mutex<HashMap<String, Arc<CourseIndex>>>>);

impl SearchIndexes {
    /// The index of `course`, opened (and created on disk) the first time. Blocks on the disk.
    fn get(&self, course: &str) -> Result<Arc<CourseIndex>, lecter_index::Error> {
        let mut map = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(index) = map.get(course) {
            return Ok(Arc::clone(index));
        }
        let index = Arc::new(CourseIndex::open(Path::new(course))?);
        map.insert(course.to_owned(), Arc::clone(&index));
        Ok(index)
    }
}

/// The hits for the words of `query` in the blocks of the lectures opened in `course` (a course
/// `course_open` returned this session), best BM25 score first, at most 50. A query over 1 KB is
/// E_INVALID_ARGUMENT; one with no words finds nothing.
#[tauri::command]
#[specta::specta]
pub async fn search_find(
    courses: State<'_, OpenedCourses>,
    lectures: State<'_, OpenLectures>,
    indexes: State<'_, SearchIndexes>,
    course: String,
    query: String,
) -> Result<Vec<FindHit>, IpcError> {
    find(&courses, &lectures, &indexes, course, query).await
}

/// `search_find` without Tauri's state wrappers.
async fn find(
    courses: &OpenedCourses,
    lectures: &OpenLectures,
    indexes: &SearchIndexes,
    course: String,
    query: String,
) -> Result<Vec<FindHit>, IpcError> {
    validate::string("search_find", "query", &query, IpcLimits::default().query_bytes)?;
    check_course(courses, "search_find", &course)?;
    let (lectures, indexes) = (lectures.clone(), indexes.clone());
    tauri::async_runtime::spawn_blocking(move || {
        let index = indexes.get(&course).map_err(index_error)?;
        // The open lectures' edits since they were last indexed (`index_lecture` skips unchanged text).
        for session in lectures.in_course(&course) {
            let lecture = session.lecture().map_err(super::course::ipc_error)?;
            index.index_lecture(&lecture.path, &lecture.text).map_err(index_error)?;
        }
        let mut hits = index.search(&query, MAX_HITS).map_err(index_error)?;
        // A lecture deleted or renamed since it was indexed: its entries go, and so do its hits.
        index.drop_missing(Path::new(&course), &mut hits).map_err(index_error)?;
        tracing::info!(target: "ipc", command = "search_find", hits = hits.len(), "searched");
        Ok(hits.into_iter().map(FindHit::from).collect())
    })
    .await
    .map_err(|_| IpcError::new(ErrorCode::Internal, "Lecter could not search that course."))?
}

/// Indexes the lecture `path` of `course`, whose whole text is `text`, off the caller's thread:
/// `lecture_open` calls it so an opened lecture is searchable without slowing the open. A failure
/// is logged (without content) and left for the next `search_find` to retry. The command doesn't
/// wait for the returned handle; tests do.
pub fn index_in_background(
    indexes: &SearchIndexes,
    course: String,
    path: String,
    text: String,
) -> tauri::async_runtime::JoinHandle<()> {
    let indexes = indexes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let done = indexes.get(&course).and_then(|index| index.index_lecture(&path, &text));
        if let Err(e) = done {
            tracing::warn!(target: "ipc", command = "lecture_open", code = ?e.code(), "the lecture could not be indexed");
        }
    })
}

/// The index crate's error as the contract's `IpcError`.
fn index_error(e: lecter_index::Error) -> IpcError {
    IpcError::new(e.code(), e.to_string())
}

#[cfg(test)]
mod tests;
