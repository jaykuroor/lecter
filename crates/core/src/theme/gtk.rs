//! Following the desktop's GTK theme on Linux (`12-settings-theme-onboarding.md#theme`).
//!
//! The desktop's theme name, colour scheme and accent come from the XDG settings portal, with
//! `gsettings` as fallback ([`desktop`]); live changes arrive as the portal's `SettingChanged`
//! signals or `gsettings monitor` lines, pushed by one long-lived child process, never polled
//! ([`monitor`]). The theme's `gtk-4.0/gtk.css` (else `gtk-3.0/gtk.css`) is untrusted input:
//! [`css`] reads its `@define-color` names under a byte cap, never follows `@import`, and
//! resolves references with a depth limit; [`tokens`] maps them to Lecter's colour tokens, and
//! every value leaves as text formatted from validated numbers ([`color`]). [`follow`] parses a
//! theme once per change and caches the result.

pub mod color;
pub mod css;
pub mod folders;
pub mod tokens;

/// A file or folder under `tests/fixtures/gtk-themes`.
#[cfg(test)]
pub(crate) fn fixture(rel: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/gtk-themes").join(rel)
}
