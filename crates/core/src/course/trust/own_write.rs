//! Lecter's own write of a trusted course's settings (Settings → This course, F-045). The trust
//! screen lists the course's settings overrides, and a change asks the trust question again
//! (SEC-25); a change the user just made through Lecter shouldn't. So the course stays trusted
//! after the write only when the write is all that changed: every other AI file hashes as before,
//! course.jsonc's `settings` is exactly the old object with Lecter's one key set, and the stored
//! answer is still Trusted with the fingerprint it had before. Anything else (an `AGENTS.md` or a
//! role that appeared, a hand edit of `settings`, a Read-only answer given meanwhile) leaves the
//! stored answer alone, so the next gated call asks again (SEC-27).

use std::path::Path;

use serde_json::{Map, Value};

use super::{TrustChoice, TrustEntry, TrustState, TrustStore, canonical_folder, plain, standing, survey};
use crate::error::{Error, Result};

/// What a trusted course's AI files were just before Lecter writes its settings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnSettingsWrite {
    /// The course's canonical path, as `trusted.jsonc` keys it.
    path: String,
    fingerprint: String,
    rest: String,
    settings: Value,
}

/// Before Lecter writes the course at `course`'s own settings: the course must be trusted as it is
/// now ([`Error::CourseReadOnly`] or [`Error::CourseNotTrusted`] otherwise, as `require_trusted`),
/// and its course.jsonc usable. Returns what [`finish_own_settings_write`] compares.
pub fn begin_own_settings_write(store: &TrustStore, course: &Path) -> Result<OwnSettingsWrite> {
    let root = canonical_folder(course)?;
    let path = plain(root.to_str().ok_or(Error::NotUnicode)?);
    let found = survey::ai(Path::new(&path)).map_err(|_| Error::CourseNotTrusted)?;
    match standing(store.get(&path)?, &found.fingerprint).0 {
        TrustState::Trusted => {}
        TrustState::ReadOnly => return Err(Error::CourseReadOnly),
        TrustState::Ask => return Err(Error::CourseNotTrusted),
    }
    let settings = found.settings.ok_or(Error::CourseNotTrusted)?;
    Ok(OwnSettingsWrite { path, fingerprint: found.fingerprint, rest: found.rest, settings })
}

/// After Lecter wrote `key = value` (dotted key, as the settings store writes it) into the course's
/// settings: keeps the course trusted with its new fingerprint when that write is all that
/// changed since [`begin_own_settings_write`]. Returns whether it did; when it didn't, the stored
/// answer is left as it was, and the course asks again.
pub fn finish_own_settings_write(
    store: &TrustStore,
    before: OwnSettingsWrite,
    key: &str,
    value: &Value,
) -> Result<bool> {
    let Ok(now) = survey::ai(Path::new(&before.path)) else { return Ok(false) };
    let expected = with_key(&before.settings, key, value);
    if now.rest != before.rest || now.settings.is_none() || now.settings != expected {
        return Ok(false);
    }
    let was = TrustEntry { choice: TrustChoice::Trusted, fingerprint: before.fingerprint };
    let renewed = TrustEntry { choice: TrustChoice::Trusted, fingerprint: now.fingerprint };
    store.update(&before.path, |current| (current == Some(was)).then_some(renewed))
}

/// `settings` with the dotted `key` set to `value`, creating the groups on the way; `None` when a
/// group on the way isn't an object (the write couldn't have made that).
fn with_key(settings: &Value, key: &str, value: &Value) -> Option<Value> {
    let mut out = settings.clone();
    let mut node = &mut out;
    let parts: Vec<&str> = key.split('.').collect();
    let (last, groups) = parts.split_last()?;
    for group in groups {
        node = node.as_object_mut()?.entry((*group).to_owned()).or_insert_with(|| Value::Object(Map::new()));
    }
    node.as_object_mut()?.insert((*last).to_owned(), value.clone());
    Some(out)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn with_key_sets_a_nested_key_and_keeps_the_rest() {
        let base = json!({ "ui": { "performance": "quality" }, "ai": { "hedgeAfterMs": 900 } });
        assert_eq!(
            with_key(&base, "ui.hintBar", &json!("off")),
            Some(json!({ "ui": { "performance": "quality", "hintBar": "off" }, "ai": { "hedgeAfterMs": 900 } }))
        );
        assert_eq!(with_key(&json!({}), "a.b.c", &json!(1)), Some(json!({ "a": { "b": { "c": 1 } } })));
        assert_eq!(with_key(&json!({ "ui": 3 }), "ui.hintBar", &json!("off")), None);
        assert_eq!(with_key(&json!([]), "x", &json!(1)), None);
    }
}
