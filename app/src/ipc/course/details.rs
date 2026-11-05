//! `course_details_save`: the course details form's Save (02-course-folder.md#course-details-coursejsonc).
//! The core checks every field and writes `.lecter/course.jsonc` with `"version": 1`, for a course
//! trusted as it is now only (SEC-27); a read-only course is E_NOT_TRUSTED and nothing is written.

use std::path::Path;

use lecter_core::course::details::{self, CourseDetails};
use tauri::State;

use super::super::error::IpcError;
use super::super::lecture::check_course;
use super::super::session::OpenedCourses;
use super::blocking;

/// Saves `details` for `course` (a course `course_open` returned this session) and returns them as
/// written: trimmed, the colour in lower case.
#[tauri::command]
#[specta::specta]
pub async fn course_details_save(
    courses: State<'_, OpenedCourses>,
    course: String,
    details: CourseDetails,
) -> Result<CourseDetails, IpcError> {
    save(&courses, course, details).await
}

/// `course_details_save` without Tauri's state wrappers.
pub(super) async fn save(
    courses: &OpenedCourses,
    course: String,
    details: CourseDetails,
) -> Result<CourseDetails, IpcError> {
    check_course(courses, "course_details_save", &course)?;
    let store = courses.trust().clone();
    let saved = blocking("Lecter could not save the course details.", move || {
        details::save(&store, Path::new(&course), &details)
    })
    .await?;
    tracing::info!(target: "ipc", command = "course_details_save", "course details saved");
    Ok(saved)
}

#[cfg(test)]
mod tests;
