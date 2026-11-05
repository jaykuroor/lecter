//! What this app session has opened. A command that takes a course path accepts only a folder the
//! user picked in a dialog this session (18-contracts.md#validation, SEC-32, SEC-35): `course_open`
//! remembers each course it returns, and other commands check against that list. The lecture in
//! the buffer has a save session (`lecter_core::save`), which edits go to.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use lecter_core::course::trust::TrustStore;
use lecter_core::save::Session;

/// The courses `course_open` returned this session, by the `path` the UI received, each with the
/// fingerprint of the AI files its trust screen showed; and the stored trust answers.
#[derive(Debug)]
pub struct OpenedCourses {
    shown: Mutex<HashMap<String, String>>,
    trust: TrustStore,
}

impl OpenedCourses {
    /// No course opened yet; trust answers live in `trust`.
    pub fn new(trust: TrustStore) -> Self {
        Self { shown: Mutex::default(), trust }
    }

    /// Remembers a course the user picked (its canonical `path` from the listing) and the
    /// fingerprint of the AI files its trust screen showed.
    pub fn remember(&self, path: &str, fingerprint: &str) {
        self.lock().insert(path.to_owned(), fingerprint.to_owned());
    }

    /// Whether `path` is a course the user picked this session, compared exactly.
    pub fn contains(&self, path: &str) -> bool {
        self.lock().contains_key(path)
    }

    /// The fingerprint the trust screen of `path` showed, if it was opened this session.
    pub fn shown(&self, path: &str) -> Option<String> {
        self.lock().get(path).cloned()
    }

    /// The stored trust answers (`trusted.jsonc`).
    pub fn trust(&self) -> &TrustStore {
        &self.trust
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
        self.shown.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// The open lectures' save sessions, by course and course-relative path. Cloning shares them.
#[derive(Debug, Default, Clone)]
pub struct OpenLectures(Arc<Mutex<Sessions>>);

/// Save sessions by (course, course-relative path).
type Sessions = HashMap<(String, String), Arc<Session>>;

impl OpenLectures {
    /// The session of `path` in `course`, if it is open.
    pub fn get(&self, course: &str, path: &str) -> Option<Arc<Session>> {
        self.lock().get(&(course.to_owned(), path.to_owned())).cloned()
    }

    /// The session of `path` in `course`, opened with `open` if it isn't yet. The buffer shows one
    /// lecture at a time, so opening one closes the others' sessions (each saves what is pending)
    /// and returns them, for the caller to close. The lock is held while `open` runs, so two
    /// opens of one lecture never start two sessions on its files.
    pub fn get_or_open<E>(
        &self,
        course: &str,
        path: &str,
        open: impl FnOnce() -> Result<Session, E>,
    ) -> Result<(Arc<Session>, Vec<Arc<Session>>), E> {
        let key = (course.to_owned(), path.to_owned());
        let mut map = self.lock();
        let session = match map.get(&key) {
            Some(s) => Arc::clone(s),
            None => Arc::new(open()?),
        };
        let others = map.drain().filter(|(k, _)| *k != key).map(|(_, s)| s).collect();
        map.insert(key, Arc::clone(&session));
        Ok((session, others))
    }

    /// The open sessions of `course`, in no set order.
    pub fn in_course(&self, course: &str) -> Vec<Arc<Session>> {
        self.lock().iter().filter(|((c, _), _)| c == course).map(|(_, s)| Arc::clone(s)).collect()
    }

    /// Removes every session, for the caller to close.
    pub fn take_all(&self) -> Vec<Arc<Session>> {
        self.lock().drain().map(|(_, s)| s).collect()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Sessions> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_remembered_courses_are_known_and_only_exactly() {
        let courses = OpenedCourses::new(TrustStore::in_folder("/config".into()));
        assert!(!courses.contains("/c/STAT311"));
        assert_eq!(courses.shown("/c/STAT311"), None);
        courses.remember("/c/STAT311", "f1");
        assert!(courses.contains("/c/STAT311"));
        assert_eq!(courses.shown("/c/STAT311").as_deref(), Some("f1"));
        courses.remember("/c/STAT311", "f2");
        assert_eq!(courses.shown("/c/STAT311").as_deref(), Some("f2"));
        for other in ["/c/STAT311/", "/c/STAT31", "/c/stat311", "/c", "/c/STAT311/lectures", ""] {
            assert!(!courses.contains(other), "{other}");
        }
    }
}
