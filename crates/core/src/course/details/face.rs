//! How a course looks on the rail (09-ui.md#layout): its name, icon and colour from
//! `.lecter/course.jsonc` where they are usable, guessed from the folder's name where not.
//!
//! The file is the course's own and may be untrusted: each value goes through the same checks
//! [`super::save`] applies (length, control characters, `#rrggbb`, an icon image inside
//! `.lecter/`, SEC-35), and one that fails them is replaced by its guess, never shown as written.

use std::path::Path;

use serde_json::{Map, Value};

use super::{check, guess, stored};

/// A course's name, icon and colour, as the rail shows them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Face {
    /// The course's name, e.g. `Probability and Statistics`. Never empty.
    pub name: String,
    /// A short text (e.g. `S`), or the course-relative path of an image in `.lecter/`.
    pub icon: String,
    /// `#rrggbb`, in lower case.
    pub color: String,
}

/// The face of the canonical course folder `root` (an existing folder).
pub fn face(root: &Path) -> Face {
    let map = stored(root).unwrap_or_default();
    let folder = root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let parsed = guess::parse(&folder);
    let text = |key: &str| map_str(&map, key).and_then(|v| check::text(key, v).ok()).filter(|v| !v.is_empty());
    let name = text("name").unwrap_or_else(|| fallback_name(&parsed.name, &folder));
    let code = text("code").unwrap_or(parsed.code);
    let icon =
        map_str(&map, "icon").and_then(|v| check::icon(root, v).ok()).unwrap_or_else(|| guess::icon(&code, &name));
    let color = map_str(&map, "color").and_then(|v| check::color(v).ok()).unwrap_or_else(default_color);
    Face { name, icon, color }
}

/// The face of a course on the rail whose folder can't be opened: its last path component as the
/// name, guessed the same way, so the rail can still show it (as missing).
pub fn face_of_missing(path: &str) -> Face {
    // Both separators: a path stored on Windows ends in `\name`.
    let folder = path.rsplit(['/', '\\']).find(|s| !s.is_empty()).unwrap_or(path);
    let parsed = guess::parse(folder);
    let name = fallback_name(&parsed.name, folder);
    Face { icon: guess::icon(&parsed.code, &name), name, color: default_color() }
}

/// The colour a course has until its details say otherwise (D-186).
fn default_color() -> String {
    guess::DEFAULT_COLOR.to_owned()
}

/// The guessed name, else the folder's own name, else a word; never empty.
fn fallback_name(parsed: &str, folder: &str) -> String {
    [parsed, folder].into_iter().map(str::trim).find(|s| !s.is_empty()).unwrap_or("Course").to_owned()
}

fn map_str<'a>(map: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    map.get(key).and_then(Value::as_str)
}

// The fixtures live in a TestEnv home, which exists in debug and test-hooks builds only.
#[cfg(all(test, any(debug_assertions, feature = "test-hooks")))]
#[allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::testenv::TestEnv;

    fn course(env: &TestEnv, folder: &str, jsonc: Option<&str>) -> PathBuf {
        let root = env.home().join(folder);
        std::fs::create_dir_all(root.join(".lecter")).unwrap_or_else(|e| panic!("{e}"));
        if let Some(text) = jsonc {
            std::fs::write(root.join(".lecter/course.jsonc"), text).unwrap_or_else(|e| panic!("{e}"));
        }
        std::fs::canonicalize(root).unwrap_or_else(|e| panic!("{e}"))
    }

    fn env() -> TestEnv {
        TestEnv::new().unwrap_or_else(|e| panic!("{e}"))
    }

    #[test]
    fn saved_details_give_the_name_icon_and_colour() {
        let env = env();
        let root = course(
            &env,
            "stat311",
            Some(
                r##"{ // comments are fine
                "version": 1, "name": " Probability and Statistics ", "code": "STAT 311",
                "icon": "S", "color": "#3584E4" }"##,
            ),
        );
        let want = Face { name: "Probability and Statistics".into(), icon: "S".into(), color: "#3584e4".into() };
        assert_eq!(face(&root), want);
    }

    #[test]
    fn an_image_icon_inside_lecter_is_kept() {
        let env = env();
        let root = course(&env, "bio", Some(r#"{"name": "Biology", "icon": ".lecter/icon.png"}"#));
        std::fs::write(root.join(".lecter/icon.png"), b"png").unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(face(&root).icon, ".lecter/icon.png");
    }

    #[test]
    fn without_a_file_the_folder_name_is_guessed_from() {
        let env = env();
        let root = course(&env, "STAT311 Probability Fall 2026", None);
        let got = face(&root);
        assert_eq!(got, Face { name: "Probability".into(), icon: "S".into(), color: "#3584e4".into() });
    }

    #[test]
    fn unusable_values_fall_back_to_their_guesses() {
        let env = env();
        // Too long a name, a control character in the code, a colour that isn't #rrggbb, and an
        // icon image outside .lecter/: none of them is shown as written.
        let long = "x".repeat(201);
        let text =
            format!(r#"{{"name": "{long}", "code": "M\u0007", "icon": ".lecter/../../evil.png", "color": "red;x"}}"#);
        let root = course(&env, "calculus", Some(&text));
        assert_eq!(face(&root), Face { name: "calculus".into(), icon: "C".into(), color: "#3584e4".into() });
        // Not strings at all, or an empty name.
        let root = course(&env, "MATH 221", Some(r#"{"name": "", "icon": 7, "color": null}"#));
        assert_eq!(face(&root), Face { name: "MATH 221".into(), icon: "M".into(), color: "#3584e4".into() });
    }

    #[test]
    fn a_broken_file_or_one_that_isnt_an_object_is_ignored() {
        let env = env();
        for text in ["{ not jsonc", "[1, 2]", "\"name\""] {
            let root = course(&env, "physics", Some(text));
            assert_eq!(face(&root).name, "physics", "{text}");
        }
    }

    #[test]
    fn a_missing_course_is_named_after_its_last_component() {
        let want = |name: &str, icon: &str| Face { name: name.into(), icon: icon.into(), color: "#3584e4".into() };
        assert_eq!(face_of_missing("/c/STAT311 Probability"), want("Probability", "S"));
        assert_eq!(face_of_missing("/c/biology/"), want("biology", "B"));
        assert_eq!(face_of_missing(r"C:\Courses\chem"), want("chem", "C"));
        assert_eq!(face_of_missing("/"), want("/", "C"));
    }
}
