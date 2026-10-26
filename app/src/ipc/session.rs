//! What this app session has opened. A command that takes a course path accepts only a folder the
//! user picked in a dialog this session (18-contracts.md#validation, SEC-32, SEC-35): `course_open`
//! remembers each course it returns, and other commands check against that list. The lecture in
//! the buffer has a save session (`lecter_core::save`), which edits go to.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, PoisonError};

use lecter_core::save::Session;

/// The courses `course_open` returned this session, by the `path` the UI received.
#[derive(Debug, Default)]
pub struct OpenedCourses(Mutex<HashSet<String>>);

impl OpenedCourses {
    /// Remembers a course the user picked (its canonical `path` from the listing).
    pub fn remember(&self, path: &str) {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).insert(path.to_owned());
    }

    /// Whether `path` is a course the user picked this session, compared exactly.
    pub fn contains(&self, path: &str) -> bool {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).contains(path)
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
        let courses = OpenedCourses::default();
        assert!(!courses.contains("/c/STAT311"));
        courses.remember("/c/STAT311");
        assert!(courses.contains("/c/STAT311"));
        for other in ["/c/STAT311/", "/c/STAT31", "/c/stat311", "/c", "/c/STAT311/lectures", ""] {
            assert!(!courses.contains(other), "{other}");
        }
    }
}
