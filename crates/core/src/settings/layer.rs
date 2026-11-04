//! One level of the precedence chain: the values one file (or a prompt) sets, sorted into known,
//! unknown, invalid and (for a course) global-only keys.

use std::collections::BTreeMap;

use serde_json::Value;

use super::global_only::is_global_only;
use super::keys::{is_group, is_known, join, validate};

/// Where a resolved value came from, most specific first (`12-settings-theme-onboarding.md#settings`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Source {
    /// This one prompt (`@web`, the globe toggle).
    Prompt,
    /// The role file of the gloss type.
    Role,
    /// The course's `.lecter/course.jsonc`.
    Course,
    /// The global `config.jsonc`.
    Global,
    /// Lecter's built-in default.
    Default,
}

impl Source {
    /// Course-level sources, which can't set global-only keys (SEC-25).
    pub fn is_course_level(self) -> bool {
        matches!(self, Self::Course | Self::Role)
    }
}

/// How deep a settings object is walked. Known keys are at most four levels deep; anything
/// deeper is an unknown key's inside and is kept in the file untouched.
const MAX_DEPTH: usize = 16;

/// The values one source sets, plus what it set that Lecter can't use.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Layer {
    /// Known keys with valid values.
    pub(crate) values: BTreeMap<String, Value>,
    /// Keys no setting has (kept in the file, reported).
    pub unknown: Vec<String>,
    /// Known keys whose value has the wrong type or isn't allowed, with the reason.
    pub invalid: Vec<(String, String)>,
    /// Global-only keys a course set (ignored, SEC-25).
    pub ignored: Vec<String>,
}

impl Layer {
    /// Sorts the settings object `object` (nested, as in the file) from `source`.
    pub fn from_value(source: Source, object: &Value) -> Self {
        let mut layer = Self::default();
        if let Value::Object(map) = object {
            for (k, v) in map {
                layer.walk(source, &join("", k), k, v, 0);
            }
        }
        layer
    }

    /// One entry at `path` (the dotted key so far; `segment` is its last part).
    fn walk(&mut self, source: Source, path: &str, segment: &str, value: &Value, depth: usize) {
        if source.is_course_level() && is_global_only(path) {
            self.ignored.push(path.to_owned());
            return;
        }
        // A dot inside one key name would read as a path; such a key is never a setting.
        if segment.is_empty() || segment.contains('.') {
            self.unknown.push(path.to_owned());
            return;
        }
        if is_known(path) {
            match validate(path, value) {
                Ok(()) => {
                    self.values.insert(path.to_owned(), value.clone());
                }
                Err(reason) => self.invalid.push((path.to_owned(), reason)),
            }
            return;
        }
        match value {
            Value::Object(map) if depth < MAX_DEPTH && (is_group(path) || source.is_course_level()) => {
                // Course levels look inside unknown groups too, so a global-only key can't hide
                // under a misspelt parent; global levels report the first unknown name.
                let before = self.unknown.len();
                for (k, v) in map {
                    self.walk(source, &join(path, k), k, v, depth + 1);
                }
                if !is_group(path) && self.unknown.len() > before {
                    self.unknown.truncate(before);
                    self.unknown.push(path.to_owned());
                }
            }
            _ if is_group(path) => self.invalid.push((path.to_owned(), format!("{path} must be an object"))),
            _ => self.unknown.push(path.to_owned()),
        }
    }

    /// The value this layer sets for `key`, if any.
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.values.get(key)
    }

    /// Removes `key`, returning its value.
    pub(crate) fn remove(&mut self, key: &str) -> Option<Value> {
        self.values.remove(key)
    }

    /// The keys this layer sets.
    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.values.keys().map(String::as_str)
    }
}
