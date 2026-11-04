//! Settings (`12-settings-theme-onboarding.md#settings`): one schema generated from Rust types
//! ([`schema`]), JSONC files, and the precedence chain per prompt > role file > course > global >
//! built-in default, where each value reports its [`Source`].
//!
//! Unknown keys stay in the files and are reported once. A course can't set global-only keys or
//! loosen global values (`13-security.md` SEC-25); such keys are ignored with one notice. Files
//! edited on disk apply without a restart ([`SettingsWatcher`]).

mod global_only;
mod jsonc;
mod keys;
mod layer;
mod resolve;
pub mod schema;
mod store;
mod watch;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_files;
#[cfg(test)]
mod tests_sec25;
#[cfg(test)]
mod tests_watch;

pub use jsonc::FileError;
pub use layer::{Layer, Source};
pub use resolve::{Resolved, SettingsStack};
pub use schema::{Settings, schema_json};
pub use store::{COURSE_FILE, GLOBAL_FILE, Notice, Scope, SetError, SettingsStore};
pub use watch::{SettingsWatcher, WatchError};

/// The dotted keys of every setting, sorted (for `:set` completion and the Settings window).
pub fn known_keys() -> impl Iterator<Item = &'static str> {
    keys::defaults().keys().map(String::as_str)
}

/// The values a key is limited to (`ui.performance` → performance, balanced, quality); `None`
/// for a key that takes free values or doesn't exist.
pub fn allowed_values(key: &str) -> Option<Vec<String>> {
    keys::is_known(key).then(|| keys::allowed_values(key)).flatten()
}
