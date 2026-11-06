//! What the UI should look like, from the desktop's settings and the user's choice: which GTK
//! theme applies, light or dark, and the tokens to set, as one [`ThemeUpdate`] the UI applies in
//! one batch. A theme's stylesheet is read and parsed once per change of file (path and
//! modification time) and its colours cached, so a scheme or accent change costs no file read.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use serde::Serialize;

use super::css::{Defines, read_css};
use super::desktop::{Change, Desktop};
use super::folders::ThemeDirs;
use super::tokens::{Scheme, ThemeColors, Token, to_css};

/// Parsed themes kept.
const CACHE: usize = 4;

/// What the UI applies.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ThemeUpdate {
    /// The GTK theme in use, or `None` for the Lecter theme.
    pub theme: Option<String>,
    /// Light or dark; `None` leaves it to the OS preference the webview reports.
    pub scheme: Option<Scheme>,
    /// The tokens to set; every other token keeps the Lecter theme's value.
    pub tokens: Vec<Token>,
}

/// The desktop's state, the user's choice and the parsed themes.
#[derive(Debug)]
pub struct Follower {
    dirs: ThemeDirs,
    desktop: Desktop,
    chosen: Option<String>,
    cache: Vec<(PathBuf, Option<SystemTime>, Arc<ThemeColors>)>,
    reads: usize,
}

impl Follower {
    /// Looks themes up in `dirs`.
    pub fn new(dirs: ThemeDirs) -> Self {
        Self { dirs, desktop: Desktop::default(), chosen: None, cache: Vec::new(), reads: 0 }
    }

    /// The theme folders.
    pub fn dirs(&self) -> &ThemeDirs {
        &self.dirs
    }

    /// Replaces what the desktop says; whether it changed.
    pub fn set_desktop(&mut self, desktop: Desktop) -> bool {
        let changed = self.desktop != desktop;
        self.desktop = desktop;
        changed
    }

    /// Applies one desktop change; whether it changed anything.
    pub fn change(&mut self, change: Change) -> bool {
        self.desktop.apply(change)
    }

    /// The theme the user chose (`ui.theme`) instead of the desktop's; `None` follows the
    /// desktop. Whether it changed.
    pub fn choose(&mut self, theme: Option<String>) -> bool {
        let changed = self.chosen != theme;
        self.chosen = theme;
        changed
    }

    /// How many stylesheets have been read and parsed so far.
    pub fn reads(&self) -> usize {
        self.reads
    }

    /// The update for the current state. The chosen theme wins when it is installed, then the
    /// desktop's; the desktop's accent wins over the theme's. Blocking (it may read a
    /// stylesheet): async callers run it in `spawn_blocking`.
    pub fn update(&mut self) -> ThemeUpdate {
        let preference = self.desktop.scheme;
        let found = [self.chosen.as_deref(), self.desktop.theme.as_deref()]
            .into_iter()
            .flatten()
            .find_map(|name| self.dirs.find(name).map(|files| (name.to_owned(), files)));
        let (theme, colors) = match found {
            Some((name, files)) => (Some(name), Some(self.colors(files.for_scheme(preference)))),
            None => (None, None),
        };
        let scheme = colors.as_ref().and_then(|c| c.scheme()).or(preference);
        let dark = scheme == Some(Scheme::Dark);
        let mut tokens = colors.map(|c| c.tokens(if dark { Scheme::Dark } else { Scheme::Light })).unwrap_or_default();
        if let Some(accent) = self.desktop.accent {
            tokens.retain(|(name, _)| !matches!(*name, "accent-bg" | "accent"));
            tokens.push(("accent-bg", accent));
            tokens.push(("accent", accent.standalone(dark)));
        }
        ThemeUpdate { theme, scheme, tokens: to_css(&tokens) }
    }

    /// The colours of one stylesheet, from the cache while the file is unchanged.
    fn colors(&mut self, css: &Path) -> Arc<ThemeColors> {
        let modified = modified(css);
        if let Some(i) = self.cache.iter().position(|(p, m, _)| p == css && *m == modified) {
            let entry = self.cache.remove(i);
            let colors = Arc::clone(&entry.2);
            self.cache.push(entry);
            return colors;
        }
        self.reads += 1;
        // An unreadable or oversized stylesheet applies nothing: the Lecter theme stays.
        let colors =
            Arc::new(read_css(css).map(|text| ThemeColors::resolve(&Defines::parse(&text))).unwrap_or_default());
        self.cache.retain(|(p, _, _)| p != css);
        if self.cache.len() >= CACHE {
            self.cache.remove(0);
        }
        self.cache.push((css.to_path_buf(), modified, Arc::clone(&colors)));
        colors
    }
}

#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
fn modified(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

#[cfg(test)]
#[path = "follow_tests.rs"]
mod tests;
