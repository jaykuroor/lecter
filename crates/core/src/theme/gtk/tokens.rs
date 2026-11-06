//! A GTK theme's named colours → Lecter's colour tokens, as `docs/design/tokens.json` maps them
//! (its `gtk` field): libadwaita's names one to one, the derived tokens (`dim`, `faint`,
//! `line2`, `osd-*`, `borders` without a `borders` colour) from those, and the nine gloss
//! colours from the theme's palette (`blue_4`, `green_5`, …). A token whose GTK colours the
//! theme doesn't define is left out, so the Lecter theme's value stays (12-settings-theme-
//! onboarding.md#theme).

use serde::Serialize;

use super::color::Rgba;
use super::css::Defines;

/// Light or dark.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum Scheme {
    /// Dark text on light surfaces.
    Light,
    /// Light text on dark surfaces.
    Dark,
}

/// One token as the UI sets it: `--<name>: <value>`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Token {
    /// The token's name without the leading `--`, e.g. `window-bg`.
    pub name: String,
    /// CSS colour text this crate formatted from numbers: `#rrggbb` or `rgba(r, g, b, a)`.
    pub value: String,
}

/// A token taken straight from the first of its GTK names the theme defines. Each list starts
/// with libadwaita's name (tokens.json); the others are the GTK 3 names libadwaita itself
/// aliases to it (`theme_bg_color` is `window_bg_color`), then their older GTK 2-era forms.
pub const DIRECT: [(&str, &[&str]); 12] = [
    ("window-bg", &["window_bg_color", "theme_bg_color", "bg_color"]),
    ("window-fg", &["window_fg_color", "theme_fg_color", "fg_color"]),
    ("view-bg", &["view_bg_color", "theme_base_color", "base_color"]),
    ("view-fg", &["view_fg_color", "theme_text_color", "text_color"]),
    ("headerbar-bg", &["headerbar_bg_color"]),
    ("headerbar-border", &["headerbar_border_color"]),
    ("sidebar-bg", &["sidebar_bg_color"]),
    ("card-bg", &["card_bg_color"]),
    ("popover-bg", &["popover_bg_color"]),
    ("accent-bg", &["accent_bg_color", "theme_selected_bg_color", "selected_bg_color"]),
    ("accent-fg", &["accent_fg_color", "theme_selected_fg_color", "selected_fg_color"]),
    ("accent", &["accent_color"]),
];

/// The gloss colours: `(token, light palette name(s), dark palette name(s))`; two names mean
/// their even mix (tokens.json `gloss-kind`).
pub const GLOSS: [(&str, &[&str], &[&str]); 9] = [
    ("k-derive", &["blue_4"], &["blue_1"]),
    ("k-ask", &["green_5"], &["green_1"]),
    ("k-doubt", &["yellow_5"], &["yellow_2"]),
    ("k-source", &["purple_4"], &["purple_1"]),
    ("k-prof", &["red_4"], &["red_1"]),
    ("k-write", &["blue_4", "green_4"], &["blue_1", "green_1"]),
    ("k-later", &["orange_5"], &["orange_2"]),
    ("k-mine", &["dark_1"], &["light_4"]),
    ("k-flag", &["red_4", "purple_4"], &["red_1", "purple_1"]),
];

/// Below this WCAG luminance a window background is dark (CIE L* 50 is Y 0.18).
const DARK_BELOW: f64 = 0.18;

/// The colours of one theme file that the mapping reads, resolved once: everything a token
/// needs is here, so changing the scheme or accent never re-reads or re-parses the file.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ThemeColors {
    direct: Vec<(&'static str, Rgba)>,
    palette: Vec<(&'static str, Rgba)>,
    borders: Option<Rgba>,
}

impl ThemeColors {
    /// Resolves the names the mapping uses from a theme's definitions.
    pub fn resolve(defines: &Defines) -> Self {
        let mut resolver = defines.resolver();
        let direct = DIRECT
            .iter()
            .filter_map(|(token, names)| names.iter().find_map(|n| resolver.get(n)).map(|c| (*token, c)))
            .collect();
        let mut palette: Vec<(&'static str, Rgba)> = Vec::new();
        for (_, light, dark) in GLOSS {
            for name in light.iter().chain(dark) {
                if !palette.iter().any(|(n, _)| n == name)
                    && let Some(c) = resolver.get(name)
                {
                    palette.push((name, c));
                }
            }
        }
        let borders = resolver.get("borders");
        Self { direct, palette, borders }
    }

    /// Whether the theme defines none of the colours Lecter maps.
    pub fn is_empty(&self) -> bool {
        self.direct.is_empty() && self.palette.is_empty() && self.borders.is_none()
    }

    /// The theme's own colour of a direct token.
    pub fn get(&self, token: &str) -> Option<Rgba> {
        self.direct.iter().find(|(t, _)| *t == token).map(|&(_, c)| c)
    }

    fn palette(&self, name: &str) -> Option<Rgba> {
        self.palette.iter().find(|(n, _)| *n == name).map(|&(_, c)| c)
    }

    /// The theme's own scheme: from its window background when it has one.
    pub fn scheme(&self) -> Option<Scheme> {
        self.get("window-bg").map(|bg| if bg.luminance() < DARK_BELOW { Scheme::Dark } else { Scheme::Light })
    }

    /// The tokens this theme sets for `scheme`, in a fixed order; the rest stay Lecter's.
    pub fn tokens(&self, scheme: Scheme) -> Vec<(&'static str, Rgba)> {
        let dark = scheme == Scheme::Dark;
        let mut out: Vec<(&'static str, Rgba)> = self.direct.clone();
        if self.get("accent").is_none()
            && let Some(bg) = self.get("accent-bg")
        {
            out.push(("accent", bg.standalone(dark)));
        }
        let window = self.get("window-fg").zip(self.get("window-bg"));
        if let Some((fg, bg)) = window {
            out.push(("dim", fg.over(bg, 0.55)));
            out.push(("faint", fg.over(bg, 0.40)));
            if !dark {
                out.push(("osd-bg", fg));
                out.push(("osd-fg", bg));
            }
        }
        match (self.borders, window) {
            (Some(b), _) => out.push(("borders", b)),
            (None, Some((fg, bg))) => out.push(("borders", fg.over(bg, 0.15))),
            (None, None) => {}
        }
        if let Some((fg, bg)) = self.get("view-fg").zip(self.get("view-bg")) {
            out.push(("line2", fg.over(bg, 0.08)));
        }
        for (token, light, dark_names) in GLOSS {
            let names = if dark { dark_names } else { light };
            let colour = match names {
                [one] => self.palette(one),
                [a, b] => self.palette(a).zip(self.palette(b)).map(|(a, b)| a.mix(b, 0.5)),
                _ => None,
            };
            if let Some(c) = colour {
                out.push((token, c));
            }
        }
        out
    }
}

/// Tokens as the UI receives them.
pub fn to_css(tokens: &[(&'static str, Rgba)]) -> Vec<Token> {
    tokens.iter().map(|(name, c)| Token { name: (*name).to_owned(), value: c.to_string() }).collect()
}

#[cfg(test)]
#[path = "tokens_tests.rs"]
mod tests;
