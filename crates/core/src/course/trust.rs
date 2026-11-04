//! Folder trust (`02-course-folder.md#trust`, `13-security.md#folder-access`).
//!
//! The first open of a course asks the user: **Trust** (full features) or **Open read-only**
//! (notes and slides only). [`review`] gathers what the trust screen shows: counts of lectures,
//! slides and sources, the provider that receives excerpts, whether web search is on, and the
//! course's own `AGENTS.md`, role files, skills and settings overrides. The answer is stored per
//! absolute path in the global `trusted.jsonc` ([`TrustStore`]) together with a fingerprint of
//! those AI files, so moving the folder, or changing any of them, asks again (SEC-25).
//!
//! The core enforces the answer (SEC-27): AI, indexing and scripted-figure commands call
//! [`require_trusted`] first and get [`Error::CourseNotTrusted`] or [`Error::CourseReadOnly`]
//! (`E_NOT_TRUSTED`) for any course not trusted as it is now. The AI's file reads go through
//! [`course_file`], which refuses every path outside the course root.
//!
//! Everything here blocks on the file system: async callers run it in `spawn_blocking`.

mod paths;
mod store;
mod survey;

use std::path::Path;

use serde::{Deserialize, Serialize};

pub use paths::course_file;
pub use store::{TRUST_FILE, TrustEntry, TrustStore};

use super::{CourseListing, canonical_folder, plain};
use crate::error::{Error, Result};
use crate::settings::schema::WebSearch;
use crate::settings::{COURSE_FILE, GLOBAL_FILE, SettingsStore};

/// The user's answer on the trust screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum TrustChoice {
    /// Full features.
    Trusted,
    /// Notes and slides only: no AI, no figures with scripts, no indexing.
    ReadOnly,
}

/// Where a course stands: the question still to ask, or the answer in force.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum TrustState {
    /// No answer for this path, or the course's AI files changed since: show the trust screen.
    Ask,
    /// Trusted as the course is now.
    Trusted,
    /// Opened read-only as the course is now.
    ReadOnly,
}

impl From<TrustChoice> for TrustState {
    fn from(choice: TrustChoice) -> Self {
        match choice {
            TrustChoice::Trusted => Self::Trusted,
            TrustChoice::ReadOnly => Self::ReadOnly,
        }
    }
}

/// What the trust screen shows. Paths are course-relative with `/` separators.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct TrustScreen {
    /// Lecture files in `lectures/`.
    pub lectures: u32,
    /// Slide files in `slides/`.
    pub slides: u32,
    /// Files in `sources/` and its subfolders (textbooks, papers, past exams).
    pub sources: u32,
    /// The provider that receives excerpts of the course.
    pub provider: String,
    /// Whether answers may search the web (`ai.webSearch` is not `off` for this course).
    pub web_search: bool,
    /// The course's `AGENTS.md`, if it has one.
    pub agents: Vec<String>,
    /// Role files: `.lecter/agents/<role>.md`.
    pub roles: Vec<String>,
    /// Skills: `.lecter/skills/<name>`.
    pub skills: Vec<String>,
    /// The settings `.lecter/course.jsonc` overrides, as dotted keys.
    pub overrides: Vec<String>,
    /// The question is asked again because the files above changed since the last answer.
    pub changed: bool,
}

/// [`review`]'s answer: where the course stands, what to show, and the fingerprint of the AI files
/// the screen lists, which [`decide`] stores with the answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Review {
    /// The question or the answer in force.
    pub state: TrustState,
    /// What the trust screen shows.
    pub screen: TrustScreen,
    /// The fingerprint of the course's `AGENTS.md`, role files, skills and settings overrides.
    pub fingerprint: String,
}

/// Gathers the trust screen for the opened course `listing` (from [`super::open`]) and looks up
/// the stored answer. `provider` names the provider that would receive excerpts.
pub fn review(store: &TrustStore, listing: &CourseListing, provider: &str) -> Result<Review> {
    let root = Path::new(&listing.path);
    let found = survey::survey(root)?;
    let entry = store.get(&listing.path)?;
    let (state, changed) = match entry {
        None => (TrustState::Ask, false),
        Some(e) if e.fingerprint != found.fingerprint => (TrustState::Ask, true),

        Some(e) => (e.choice.into(), false),
    };
    let settings =
        SettingsStore::open_files(store.config_dir().join(GLOBAL_FILE), Some(root.join(".lecter").join(COURSE_FILE)))
            .settings();
    let screen = TrustScreen {
        lectures: count(listing.lectures.len()),
        slides: count(listing.slides.len()),
        sources: found.sources,
        provider: provider.to_owned(),
        web_search: settings.ai.web_search != WebSearch::Off,
        agents: found.agents,
        roles: found.roles,
        skills: found.skills,
        overrides: found.overrides,
        changed,
    };
    Ok(Review { state, screen, fingerprint: found.fingerprint })
}

/// Stores `choice` for the course at `course` (the canonical path [`super::open`] returned) with
/// the `fingerprint` of the AI files the user saw on the screen. If those files changed in the
/// meantime, the next check finds a different fingerprint and asks again.
pub fn decide(store: &TrustStore, course: &str, choice: TrustChoice, fingerprint: &str) -> Result<TrustState> {
    store.set(course, TrustEntry { choice, fingerprint: fingerprint.to_owned() })?;
    Ok(choice.into())
}

/// Where the course at `course` (any absolute path to it) stands now: its stored answer, if its
/// AI files are unchanged since; otherwise [`TrustState::Ask`].
pub fn state(store: &TrustStore, course: &Path) -> Result<TrustState> {
    let root = canonical_folder(course)?;
    let path = plain(root.to_str().ok_or(Error::NotUnicode)?);
    let Some(entry) = store.get(&path)? else { return Ok(TrustState::Ask) };
    if survey::fingerprint(Path::new(&path))? == entry.fingerprint {
        Ok(entry.choice.into())
    } else {
        Ok(TrustState::Ask)
    }
}

/// SEC-27: succeeds only for a course trusted as it is now. AI, indexing and scripted-figure
/// commands call this before anything else; a read-only course is [`Error::CourseReadOnly`], an
/// unanswered or changed one [`Error::CourseNotTrusted`] (both `E_NOT_TRUSTED`).
pub fn require_trusted(store: &TrustStore, course: &Path) -> Result<()> {
    match state(store, course)? {
        TrustState::Trusted => Ok(()),
        TrustState::ReadOnly => Err(Error::CourseReadOnly),
        TrustState::Ask => Err(Error::CourseNotTrusted),
    }
}

/// A list length as the screen's count; a listing never holds more than `MAX_ENTRIES`.
fn count(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

#[cfg(all(test, any(debug_assertions, feature = "test-hooks")))]
mod tests;
#[cfg(all(test, any(debug_assertions, feature = "test-hooks")))]
mod tests_paths;
