//! Debug-only test hooks (01-architecture.md#debug-only-test-hooks): WebDriver can't see native
//! dialogs, so the real-app e2e answers them through the environment. `main.rs` compiles this
//! module only under `cfg(any(debug_assertions, feature = "test-hooks"))` (D-091), and
//! `scripts/check_release_binary.sh` proves a release binary holds none of these names.
//!
//! - `LECTER_TEST_PICK=<path>`: a native file or folder dialog returns this path instead of opening.
//! - `LECTER_TEST_TRUST=1`: the folder-trust question is answered "Trust".

use std::ffi::OsString;
use std::path::PathBuf;

const PICK_VAR: &str = "LECTER_TEST_PICK";
const TRUST_VAR: &str = "LECTER_TEST_TRUST";

/// The path a dialog returns instead of opening, if the run set one.
pub fn picked_path() -> Option<PathBuf> {
    pick_from(std::env::var_os(PICK_VAR))
}

/// Whether the run answers the folder-trust question with "Trust".
pub fn trust_answered() -> bool {
    trust_from(std::env::var_os(TRUST_VAR))
}

/// An empty value counts as unset, so `LECTER_TEST_PICK=` can't make a dialog return "".
fn pick_from(value: Option<OsString>) -> Option<PathBuf> {
    value.filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// Only exactly `1` answers; anything else leaves the question to the user.
fn trust_from(value: Option<OsString>) -> bool {
    value.is_some_and(|v| v == "1")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pick_returns_the_set_path() {
        assert_eq!(pick_from(Some("/courses/algebra".into())), Some(PathBuf::from("/courses/algebra")));
    }

    #[test]
    fn pick_unset_or_empty_lets_the_dialog_open() {
        assert_eq!(pick_from(None), None);
        assert_eq!(pick_from(Some(OsString::new())), None);
    }

    #[test]
    fn trust_answers_only_on_exactly_one() {
        assert!(trust_from(Some("1".into())));
        for v in ["0", "true", "yes", " 1", ""] {
            assert!(!trust_from(Some(v.into())), "{v:?} must not answer the trust question");
        }
        assert!(!trust_from(None));
    }
}
