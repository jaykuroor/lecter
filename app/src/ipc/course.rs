//! The `course` area: opening a course folder the user picks in a native dialog, returning its
//! `lectures/` and `slides/` listing (`lecter_core::course`) with its trust screen, and storing the
//! user's answer (`course_trust`, 02-course-folder.md#trust). The core enforces the answer:
//! [`require_trusted`] guards every AI and indexing command (SEC-27). After Trust, the course
//! details form saves through `course_details_save` (`details.rs`).

use std::path::{Path, PathBuf};

use lecter_core::course::details::{self as course_details, CourseDetails};
use lecter_core::course::known::KnownCourses;
use lecter_core::course::trust::{self, TrustChoice, TrustScreen, TrustState, TrustStore};
use lecter_core::course::{self, CourseListing};
use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, State};

use super::ai::Glosses;
use super::error::{ErrorCode, IpcError};
use super::lecture::check_course;
use super::session::OpenedCourses;
use crate::dialog;

/// `course_open`'s result: the folder the user picked, its listing (the same JSON the
/// command-line harness prints for `course open`), where its trust stands, and what its trust
/// screen shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct CourseOpened {
    #[serde(flatten)]
    pub course: CourseListing,
    pub trust: TrustState,
    pub screen: TrustScreen,
}

/// `course_trust`'s result: where the course's trust stands after the answer, and its screen as
/// it is now (asked again, with `changed`, when its AI files changed while the screen was open).
/// A course now trusted whose details were never saved comes with the details form's first
/// values (02-course-folder.md#course-details-coursejsonc); otherwise `details` is `null`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct CourseTrusted {
    pub trust: TrustState,
    pub screen: TrustScreen,
    pub details: Option<CourseDetails>,
}

/// Opens the native folder dialog and returns the folder with its `lectures/` and `slides/`
/// listing and its trust screen, or `None` if the user cancels. Takes no arguments: the path
/// comes from the dialog, never from the UI (SEC-32, SEC-35). A lecture linked out of the course
/// fails with E_NOT_TRUSTED; a link in slides/ that leaves it is listed, and named on the trust
/// screen (D-167). The course is remembered for this session, so its lectures can be
/// opened and its trust question answered, and it joins the course rail (`course:changed`).
#[tauri::command]
#[specta::specta]
pub async fn course_open(
    app: AppHandle,
    courses: State<'_, OpenedCourses>,
    known: State<'_, KnownCourses>,
    glosses: State<'_, Glosses>,
) -> Result<Option<CourseOpened>, IpcError> {
    let Some(picked) = dialog::pick_folder(&app).await else {
        return Ok(None);
    };
    let opened = open(&courses, picked, glosses.provider_id().to_owned(), hook_answers_trust()).await?;
    if let Some(rail) = rail::remember(&known, &opened.course.path).await {
        rail::announce(&app, rail);
    }
    Ok(Some(opened))
}

/// Answers the trust screen of `course` (a course `course_open` returned this session) with
/// `choice`: Trust, or Open read-only. The answer is stored in `trusted.jsonc` with the AI files
/// the screen showed; if they changed since, the result asks again with the new screen.
#[tauri::command]
#[specta::specta]
pub async fn course_trust(
    courses: State<'_, OpenedCourses>,
    glosses: State<'_, Glosses>,
    course: String,
    choice: TrustChoice,
) -> Result<CourseTrusted, IpcError> {
    answer(&courses, course, choice, glosses.provider_id().to_owned()).await
}

/// `course_open` after the dialog. `answered` stands for a debug run's trust hook, which answers
/// "Trust" for the user whenever the screen would ask.
async fn open(
    courses: &OpenedCourses,
    picked: PathBuf,
    provider: String,
    answered: bool,
) -> Result<CourseOpened, IpcError> {
    let store = courses.trust().clone();
    let (course, review) = blocking("Lecter could not check that folder.", move || {
        let course = course::open(&picked)?;
        let mut review = trust::review(&store, &course, &provider)?;
        if answered && review.state == TrustState::Ask && review.screen.blocked.is_none() {
            review.state = trust::decide(&store, &course.path, TrustChoice::Trusted, &review.fingerprint)?;
            review.screen.changed = false;
        }
        Ok((course, review))
    })
    .await?;
    courses.remember(&course.path, &review.fingerprint);
    Ok(CourseOpened { course, trust: review.state, screen: review.screen })
}

/// `course_trust` without Tauri's state wrappers.
async fn answer(
    courses: &OpenedCourses,
    course: String,
    choice: TrustChoice,
    provider: String,
) -> Result<CourseTrusted, IpcError> {
    check_course(courses, "course_trust", &course)?;
    let shown = courses.shown(&course).unwrap_or_default();
    let store = courses.trust().clone();
    let path = course.clone();
    let (review, details) = blocking("Lecter could not save your answer.", move || {
        trust::decide(&store, &path, choice, &shown)?;
        let listing = course::open(Path::new(&path))?;
        let review = trust::review(&store, &listing, &provider)?;
        let details = form_after(review.state, || course_details::pending(Path::new(&path)));
        Ok((review, details))
    })
    .await?;
    tracing::info!(target: "ipc", command = "course_trust", ?choice, state = ?review.state, "trust answered");
    courses.remember(&course, &review.fingerprint);
    Ok(CourseTrusted { trust: review.state, screen: review.screen, details })
}

/// The course details form's first values after an answer that left the course in `state`. Only
/// a trusted course gets the form: a read-only one never writes course.jsonc. The answer is
/// stored by then, so a form that can't be prepared is left out rather than failing it.
fn form_after(
    state: TrustState,
    pending: impl FnOnce() -> lecter_core::Result<Option<CourseDetails>>,
) -> Option<CourseDetails> {
    match state {
        TrustState::Trusted => pending().unwrap_or_else(|e| {
            tracing::warn!(target: "ipc", command = "course_trust", code = ?e.code(), "no course details form");
            None
        }),
        TrustState::Ask | TrustState::ReadOnly => None,
    }
}

/// SEC-27: succeeds only when `course` is trusted as it is now; a read-only, unanswered or changed
/// course is E_NOT_TRUSTED. Blocks on the disk: call it on a blocking thread.
pub(super) fn require_trusted(store: &TrustStore, course: &str) -> Result<(), IpcError> {
    trust::require_trusted(store, Path::new(course)).map_err(ipc_error)
}

/// [`require_trusted`] off the async runtime.
pub(super) async fn require_trusted_async(courses: &OpenedCourses, course: &str) -> Result<(), IpcError> {
    let (store, course) = (courses.trust().clone(), course.to_owned());
    blocking("Lecter could not check that course.", move || trust::require_trusted(&store, Path::new(&course))).await
}

/// Runs the core's blocking `work` on a blocking thread; `failed` is the message if that thread
/// itself fails.
async fn blocking<T: Send + 'static>(
    failed: &'static str,
    work: impl FnOnce() -> lecter_core::Result<T> + Send + 'static,
) -> Result<T, IpcError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| IpcError::new(ErrorCode::Internal, failed))?
        .map_err(ipc_error)
}

/// The core's error as the contract's `IpcError`: its code and its one-sentence message.
pub(super) fn ipc_error(e: lecter_core::Error) -> IpcError {
    IpcError::new(e.code(), e.to_string())
}

/// Whether a debug run answers the trust question with "Trust" (release builds: never).
fn hook_answers_trust() -> bool {
    #[cfg(any(debug_assertions, feature = "test-hooks"))]
    if crate::test_hooks::trust_answered() {
        return true;
    }
    false
}

/// For other areas' tests: `listing`'s course opened this session with trust kept in `env`'s
/// config folder, and answered `choice` (`None` leaves the question open).
#[cfg(test)]
pub(super) fn opened_for_test(
    env: &lecter_core::testenv::TestEnv,
    listing: &CourseListing,
    choice: Option<TrustChoice>,
) -> OpenedCourses {
    let courses = OpenedCourses::new(TrustStore::new(&env.dirs()));
    let review = trust::review(courses.trust(), listing, "fake").unwrap_or_else(|e| panic!("{e:?}"));
    if let Some(choice) = choice {
        trust::decide(courses.trust(), &listing.path, choice, &review.fingerprint).unwrap_or_else(|e| panic!("{e:?}"));
    }
    courses.remember(&listing.path, &review.fingerprint);
    courses
}

pub mod details;
pub mod rail;
#[cfg(test)]
mod tests;
