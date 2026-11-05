//! The course rail (09-ui.md#layout): the courses the user has opened, in their order, kept in
//! `<data>/state.db` (D-188, `lecter_core::course::known`). `course_list` reads them,
//! `course_reorder` saves a new order, `course_switch` opens one without the folder dialog, and
//! `course:changed` tells the UI the list changed. `course_open` adds each course it opens.
//!
//! `course_switch` opens only a course on the rail, and only while its path still leads to the
//! folder that was picked (SEC-32, SEC-35). It then goes through the same trust review as a pick:
//! an unanswered or changed course gets the trust screen, a read-only one stays read-only.

use std::path::PathBuf;

use lecter_core::course::known::{self, KnownCourse, KnownCourses};
use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, State};
use tauri_specta::Event;

use super::super::ai::Glosses;
use super::super::error::IpcError;
use super::super::session::OpenedCourses;
use super::{CourseOpened, blocking, hook_answers_trust, open};

/// `course:changed`: the rail's courses, in order, after a course joined it or it was reordered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type, Event)]
#[tauri_specta(event_name = "course:changed")]
pub struct CourseChanged {
    pub courses: Vec<KnownCourse>,
}

/// The courses on the rail, in order, each with its name, icon and colour; a course whose folder
/// is gone or leads elsewhere is marked `missing`.
#[tauri::command]
#[specta::specta]
pub async fn course_list(known: State<'_, KnownCourses>) -> Result<Vec<KnownCourse>, IpcError> {
    list(&known).await
}

/// Saves `order` (every course on the rail, each once, in its new place) and returns the rail as
/// it is now; `course:changed` follows.
#[tauri::command]
#[specta::specta]
pub async fn course_reorder(
    app: AppHandle,
    known: State<'_, KnownCourses>,
    order: Vec<String>,
) -> Result<Vec<KnownCourse>, IpcError> {
    let courses = reorder(&known, order).await?;
    announce(&app, courses.clone());
    Ok(courses)
}

/// Opens `course`, a course on the rail, as `course_open` opens a picked folder: its listing, its
/// trust state and its trust screen.
#[tauri::command]
#[specta::specta]
pub async fn course_switch(
    courses: State<'_, OpenedCourses>,
    known: State<'_, KnownCourses>,
    glosses: State<'_, Glosses>,
    course: String,
) -> Result<CourseOpened, IpcError> {
    switch(&courses, &known, course, glosses.provider_id().to_owned(), hook_answers_trust()).await
}

/// `course_list` without Tauri's state wrappers.
pub(super) async fn list(known: &KnownCourses) -> Result<Vec<KnownCourse>, IpcError> {
    let known = known.clone();
    blocking("Lecter could not read its list of courses.", move || known.list()).await
}

/// `course_reorder` without Tauri's state wrappers.
pub(super) async fn reorder(known: &KnownCourses, order: Vec<String>) -> Result<Vec<KnownCourse>, IpcError> {
    let known = known.clone();
    let courses = blocking("Lecter could not save the order of the courses.", move || {
        known.reorder(&order)?;
        known.list()
    })
    .await
    .inspect_err(|e| tracing::warn!(target: "ipc", command = "course_reorder", code = ?e.code, "reorder refused"))?;
    tracing::info!(target: "ipc", command = "course_reorder", courses = courses.len(), "rail reordered");
    Ok(courses)
}

/// `course_switch` without Tauri's state wrappers.
pub(super) async fn switch(
    courses: &OpenedCourses,
    known: &KnownCourses,
    course: String,
    provider: String,
    answered: bool,
) -> Result<CourseOpened, IpcError> {
    let store = known.clone();
    let wanted = course.clone();
    let root: PathBuf = blocking("Lecter could not check that course.", move || known::stored_root(&store, &wanted))
        .await
        .inspect_err(|e| tracing::warn!(target: "ipc", command = "course_switch", code = ?e.code, "switch refused"))?;
    let opened = open(courses, root, provider, answered).await?;
    // The folder was checked a moment ago; one swapped for a link since then is still refused.
    if opened.course.path != course {
        tracing::warn!(target: "ipc", command = "course_switch", "the course's path changed while it opened");
        return Err(super::ipc_error(lecter_core::Error::CourseMoved));
    }
    Ok(opened)
}

/// Puts the course `course_open` just opened on the rail. Returns the rail when that changed it.
/// A list that can't be saved doesn't undo the open: the course is open, just not on the rail.
pub(super) async fn remember(known: &KnownCourses, path: &str) -> Option<Vec<KnownCourse>> {
    let (known, path) = (known.clone(), path.to_owned());
    let added = blocking("Lecter could not save its list of courses.", move || {
        let (_, added) = known.add(&path)?;
        if added { known.list().map(Some) } else { Ok(None) }
    })
    .await;
    added.unwrap_or_else(|e| {
        tracing::warn!(target: "ipc", command = "course_open", code = ?e.code, "course not added to the rail");
        None
    })
}

/// Sends `course:changed` with the rail's courses.
pub(super) fn announce(app: &AppHandle, courses: Vec<KnownCourse>) {
    if let Err(e) = (CourseChanged { courses }).emit(app) {
        tracing::warn!(target: "ipc", event = "course:changed", error = %e, "event not sent");
    }
}

#[cfg(test)]
mod tests;
