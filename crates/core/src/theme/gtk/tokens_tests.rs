#![allow(clippy::disallowed_methods, reason = "tests read fixture files on plain test threads")]

use std::path::PathBuf;

use super::*;
use crate::theme::gtk::css::{Defines, read_css};

pub(crate) fn fixture(rel: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/gtk-themes").join(rel)
}

fn colours(rel: &str) -> ThemeColors {
    ThemeColors::resolve(&Defines::parse(&read_css(&fixture(rel)).unwrap()))
}

fn css_map(colors: &ThemeColors, scheme: Scheme) -> Vec<(String, String)> {
    to_css(&colors.tokens(scheme)).into_iter().map(|t| (t.name, t.value)).collect()
}

fn pairs(expected: &[(&str, &str)]) -> Vec<(String, String)> {
    expected.iter().map(|(a, b)| ((*a).to_owned(), (*b).to_owned())).collect()
}

#[test]
fn the_mapping_uses_the_gtk_names_tokens_json_gives() {
    let json: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../docs/design/tokens.json"))
            .unwrap(),
    )
    .unwrap();
    for (token, names) in DIRECT {
        let gtk = json["color"][token]["gtk"].as_str().unwrap_or_else(|| panic!("{token} in tokens.json"));
        assert_eq!(names[0], gtk, "{token}: libadwaita's name comes first");
    }
    for (token, light, dark) in GLOSS {
        let gtk = json["gloss-kind"][token]["gtk"].as_str().unwrap();
        let (l, d) = gtk.split_once(" / ").unwrap();
        for name in light {
            assert!(l.contains(name), "{token} light {name} in {l:?}");
        }
        for name in dark {
            assert!(d.contains(name), "{token} dark {name} in {d:?}");
        }
    }
    // Every token the mapping can set is a colour token tokens.json defines.
    let mut mapped: Vec<&str> = DIRECT.iter().map(|(t, _)| *t).collect();
    mapped.extend(GLOSS.iter().map(|(t, _, _)| *t));
    mapped.extend(["dim", "faint", "borders", "line2", "osd-bg", "osd-fg"]);
    for token in mapped {
        assert!(
            json["color"][token].is_object() || json["gloss-kind"][token].is_object(),
            "{token} is not in tokens.json"
        );
    }
}

#[test]
fn a_libadwaita_style_theme_sets_every_mapped_token_for_light() {
    let colors = colours("Adwaitish/gtk-4.0/gtk.css");
    assert_eq!(colors.scheme(), Some(Scheme::Light));
    assert_eq!(
        css_map(&colors, Scheme::Light),
        pairs(&[
            ("window-bg", "#fafafa"),
            ("window-fg", "#323232"),
            ("view-bg", "#ffffff"),
            ("view-fg", "#000000"),
            ("headerbar-bg", "#ebebeb"),
            ("headerbar-border", "#d0d0d0"),
            ("sidebar-bg", "#f0f0f0"),
            ("card-bg", "#fdfdfd"),
            ("popover-bg", "#fefefe"),
            ("accent-bg", "#3584e4"),
            ("accent-fg", "#ffffff"),
            // No accent_color: libadwaita's standalone accent of #3584e4 (tokens.json).
            ("accent", "#0461be"),
            // window_fg at 55 % and 40 % over window_bg: 250 − 200 × 0.55 = 140; 250 − 80 = 170.
            ("dim", "#8c8c8c"),
            ("faint", "#aaaaaa"),
            ("osd-bg", "#323232"),
            ("osd-fg", "#fafafa"),
            // No `borders`: window_fg at 15 %: 250 − 30 = 220.
            ("borders", "#dcdcdc"),
            // view_fg at 8 % over view_bg: 255 × 0.92 = 234.6.
            ("line2", "#ebebeb"),
            ("k-derive", "#1c70d8"),
            ("k-ask", "#26a269"),
            ("k-doubt", "#e5a50a"),
            ("k-source", "#803c9c"),
            ("k-prof", "#c01c28"),
            // Even mix of blue_4 and green_4: (28+46)/2, (112+194)/2, (216+126)/2.
            ("k-write", "#2599ab"),
            ("k-later", "#c64600"),
            ("k-mine", "#77767b"),
            // Even mix of red_4 and purple_4.
            ("k-flag", "#a02c62"),
        ])
    );
}

#[test]
fn the_dark_scheme_takes_the_dark_palette_and_keeps_lecters_osd() {
    let colors = colours("Adwaitish/gtk-4.0/gtk.css");
    let dark: Vec<(String, String)> = css_map(&colors, Scheme::Dark)
        .into_iter()
        .filter(|(n, _)| n.starts_with("k-") || n.starts_with("osd") || n == "accent")
        .collect();
    assert_eq!(
        dark,
        pairs(&[
            ("accent", "#81d0ff"),
            ("k-derive", "#99c0f1"),
            ("k-ask", "#8ff0a5"),
            ("k-doubt", "#f8e45c"),
            ("k-source", "#dc8bdd"),
            ("k-prof", "#f66151"),
            ("k-write", "#94d8cb"),
            ("k-later", "#ffa348"),
            ("k-mine", "#c0bfbc"),
            ("k-flag", "#e97697"),
        ])
    );
}

#[test]
fn a_gtk3_theme_maps_through_the_gtk3_names() {
    let colors = colours("Greyish/gtk-3.0/gtk.css");
    let blue_free_accent = Rgba::from_hex(0xf0544c).standalone(false).to_string();
    assert_eq!(
        css_map(&colors, Scheme::Light),
        pairs(&[
            // theme_fg_color wins over the older fg_color.
            ("window-bg", "#f7f7f7"),
            ("window-fg", "#323232"),
            ("view-bg", "#ffffff"),
            ("view-fg", "#363636"),
            ("accent-bg", "#f0544c"),
            ("accent-fg", "#ffffff"),
            ("accent", blue_free_accent.as_str()),
            ("dim", "#8b8b8b"),
            ("faint", "#a8a8a8"),
            ("osd-bg", "#323232"),
            ("osd-fg", "#f7f7f7"),
            ("borders", "rgba(0, 0, 0, 0.15)"),
            ("line2", "#efefef"),
        ])
    );
    // No headerbar, sidebar, card, popover or palette names: those stay Lecter's.
    for missing in ["headerbar-bg", "sidebar-bg", "card-bg", "popover-bg", "k-derive"] {
        assert!(!css_map(&colors, Scheme::Light).iter().any(|(n, _)| n == missing), "{missing}");
    }
}

#[test]
fn a_theme_with_only_window_colours_leaves_the_rest_to_lecter() {
    let colors = colours("Nightish/gtk-4.0/gtk.css");
    assert_eq!(colors.scheme(), Some(Scheme::Dark));
    assert_eq!(
        css_map(&colors, Scheme::Dark),
        pairs(&[
            ("window-bg", "#1e1e1e"),
            ("window-fg", "#ffffff"),
            // 30 + 225 × 0.55 = 153.75; 30 + 225 × 0.4 = 120; 30 + 225 × 0.15 = 63.75.
            ("dim", "#9a9a9a"),
            ("faint", "#787878"),
            ("borders", "#404040"),
        ])
    );
}

#[test]
fn an_import_only_theme_sets_nothing() {
    let colors = colours("Imported/gtk-3.0/gtk.css");
    assert!(colors.is_empty());
    assert_eq!(colors.scheme(), None);
    assert!(colors.tokens(Scheme::Light).is_empty());
    assert!(colors.tokens(Scheme::Dark).is_empty());
}

#[test]
fn the_scheme_follows_the_window_background_luminance() {
    let scheme =
        |bg: &str| ThemeColors::resolve(&Defines::parse(&format!("@define-color window_bg_color {bg};"))).scheme();
    assert_eq!(scheme("#ffffff"), Some(Scheme::Light));
    assert_eq!(scheme("#000000"), Some(Scheme::Dark));
    // Mid grey #808080 has luminance 0.216: light. #737373 has 0.171: dark.
    assert_eq!(scheme("#808080"), Some(Scheme::Light));
    assert_eq!(scheme("#737373"), Some(Scheme::Dark));
}

#[test]
fn a_theme_accent_colour_is_used_as_is() {
    let colors = ThemeColors::resolve(&Defines::parse(
        "@define-color accent_bg_color #3584e4; @define-color accent_color #123456;",
    ));
    assert_eq!(css_map(&colors, Scheme::Dark), pairs(&[("accent-bg", "#3584e4"), ("accent", "#123456")]));
}

#[test]
fn a_gloss_mix_needs_both_palette_colours() {
    let colors = ThemeColors::resolve(&Defines::parse("@define-color blue_4 #1c70d8; @define-color red_4 #c01c28;"));
    assert_eq!(css_map(&colors, Scheme::Light), pairs(&[("k-derive", "#1c70d8"), ("k-prof", "#c01c28")]));
    assert!(css_map(&colors, Scheme::Dark).is_empty());
}
