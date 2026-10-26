//! What this app session has opened. A command that takes a course path accepts only a folder the
//! user picked in a dialog this session (18-contracts.md#validation, SEC-32, SEC-35): `course_open`
//! remembers each course it returns, and other commands check against that list.

use std::collections::HashSet;
use std::sync::{Mutex, PoisonError};

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
