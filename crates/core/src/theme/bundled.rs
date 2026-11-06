//! The bundled themes offered on macOS and Windows (12-settings-theme-onboarding.md#theme):
//! Adwaita, Yaru, Breeze, Catppuccin, Gruvbox and Nord, each light and dark, beside any GTK theme
//! folder the user adds to `~/.themes`. A bundled theme is a set of GTK named colours
//! ([`bundled_palettes`](super::bundled_palettes)) mapped to Lecter's tokens exactly as an
//! installed GTK theme's are, so it needs no file read.
//!
//! Each theme has three names for `ui.theme`: `Nord` follows the OS light/dark mode, `Nord-light`
//! and `Nord-dark` pin one variant. An installed theme folder of the same name wins.

use std::ffi::OsString;
use std::path::PathBuf;

pub use super::bundled_palettes::{PALETTES, Palette};
use super::gtk::css::Defines;
use super::gtk::folders::{InstalledTheme, MAX_THEMES, ThemeDirs};
use super::gtk::tokens::{Scheme, ThemeColors};

/// The name suffix that pins the light variant.
pub const LIGHT_SUFFIX: &str = "-light";
/// The name suffix that pins the dark variant.
pub const DARK_SUFFIX: &str = "-dark";

/// A bundled theme as one `ui.theme` name chose it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bundled {
    /// The theme's colours.
    pub palette: &'static Palette,
    /// The variant the name pins (`-light`, `-dark`); `None` follows the OS.
    pub pinned: Option<Scheme>,
}

impl Bundled {
    /// The bundled theme a `ui.theme` name stands for: a theme's name exactly as listed, with an
    /// optional `-light` or `-dark` suffix.
    pub fn find(name: &str) -> Option<Self> {
        let (base, pinned) = if let Some(base) = name.strip_suffix(DARK_SUFFIX) {
            (base, Some(Scheme::Dark))
        } else if let Some(base) = name.strip_suffix(LIGHT_SUFFIX) {
            (base, Some(Scheme::Light))
        } else {
            (name, None)
        };
        PALETTES.iter().find(|p| p.name == base).map(|palette| Self { palette, pinned })
    }

    /// The variant shown when the OS prefers `preference`: the pinned one, else the OS's, else
    /// light.
    pub fn scheme(&self, preference: Option<Scheme>) -> Scheme {
        self.pinned.or(preference).unwrap_or(Scheme::Light)
    }

    /// The colours of one variant.
    pub fn colors(&self, scheme: Scheme) -> ThemeColors {
        let text = match scheme {
            Scheme::Light => self.palette.light,
            Scheme::Dark => self.palette.dark,
        };
        ThemeColors::resolve(&Defines::parse(text))
    }
}

/// Every bundled name, in the order of [`PALETTES`]: each theme, then its light and dark variants.
pub fn names() -> impl Iterator<Item = String> {
    PALETTES
        .iter()
        .flat_map(|p| [p.name.to_owned(), format!("{}{LIGHT_SUFFIX}", p.name), format!("{}{DARK_SUFFIX}", p.name)])
}

/// The installed themes and the bundled ones, each name once (an installed theme wins), sorted
/// by name ignoring case as [`ThemeDirs::list`] sorts; a bundled theme's `folder` is empty.
pub fn offer(mut installed: Vec<InstalledTheme>) -> Vec<InstalledTheme> {
    for name in names() {
        if installed.len() >= MAX_THEMES {
            break;
        }
        if !installed.iter().any(|t| t.name == name) {
            installed.push(InstalledTheme { name, folder: String::new() });
        }
    }
    installed.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then_with(|| a.name.cmp(&b.name)));
    installed
}

/// The theme folder on macOS and Windows: `~/.themes`, the home folder from `HOME`, else
/// `USERPROFILE` (Windows sets only that); none when neither is set.
pub fn user_dirs(env: impl Fn(&str) -> Option<OsString>) -> ThemeDirs {
    let home = ["HOME", "USERPROFILE"].iter().find_map(|k| env(k).filter(|v| !v.is_empty())).map(PathBuf::from);
    ThemeDirs::new(home.map(|h| h.join(".themes")).into_iter().collect(), vec![])
}

#[cfg(test)]
#[path = "bundled_tests.rs"]
mod tests;
