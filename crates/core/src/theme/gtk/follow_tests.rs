#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::time::{Duration, SystemTime};

use super::*;
use crate::testenv::TestEnv;
use crate::theme::gtk::color::Rgba;
use crate::theme::gtk::css::MAX_CSS_BYTES;
use crate::theme::gtk::fixture;

fn fixtures() -> Follower {
    Follower::new(ThemeDirs::new(vec![fixture("")], vec![]))
}

fn desktop(theme: Option<&str>, scheme: Option<Scheme>, accent: Option<u32>) -> Desktop {
    Desktop { theme: theme.map(str::to_owned), scheme, accent: accent.map(Rgba::from_hex) }
}

fn token<'a>(update: &'a ThemeUpdate, name: &str) -> Option<&'a str> {
    update.tokens.iter().find(|t| t.name == name).map(|t| t.value.as_str())
}

#[test]
fn without_a_theme_or_accent_nothing_is_set() {
    let mut f = fixtures();
    assert_eq!(f.update(), ThemeUpdate::default());
    f.set_desktop(desktop(Some("NotInstalled"), Some(Scheme::Dark), None));
    assert_eq!(f.update(), ThemeUpdate { theme: None, scheme: Some(Scheme::Dark), tokens: vec![] });
}

#[test]
fn the_desktops_theme_applies_with_its_own_scheme() {
    let mut f = fixtures();
    f.set_desktop(desktop(Some("Adwaitish"), Some(Scheme::Dark), None));
    let update = f.update();
    assert_eq!(update.theme.as_deref(), Some("Adwaitish"));
    // A light theme stays light even when the desktop prefers dark: its window is #fafafa.
    assert_eq!(update.scheme, Some(Scheme::Light));
    assert_eq!(update.tokens.len(), 27);
    assert_eq!(token(&update, "window-bg"), Some("#fafafa"));
    assert_eq!(token(&update, "k-derive"), Some("#1c70d8"));
    assert_eq!(token(&update, "accent"), Some("#0461be"));
}

#[test]
fn a_dark_stylesheet_is_used_when_the_desktop_prefers_dark() {
    let mut f = fixtures();
    f.set_desktop(desktop(Some("Variant"), Some(Scheme::Dark), None));
    let dark = f.update();
    assert_eq!((dark.scheme, token(&dark, "window-bg")), (Some(Scheme::Dark), Some("#202020")));
    assert_eq!(f.stylesheet(), Some(fixture("Variant/gtk-3.0/gtk-dark.css").as_path()));
    f.change(Change::Scheme(None));
    assert_eq!(f.desktop().scheme, None);
    let light = f.update();
    assert_eq!((light.scheme, token(&light, "window-bg")), (Some(Scheme::Light), Some("#fafafa")));
    assert_eq!(f.stylesheet(), Some(fixture("Variant/gtk-3.0/gtk.css").as_path()));
    // A theme that isn't installed applies nothing, and no stylesheet was used.
    f.change(Change::Theme(Some("NotInstalled".into())));
    assert_eq!(f.update().theme, None);
    assert_eq!(f.stylesheet(), None);
}

#[test]
fn the_chosen_theme_wins_and_a_missing_choice_falls_back_to_the_desktops() {
    let mut f = fixtures();
    f.set_desktop(desktop(Some("Adwaitish"), None, None));
    assert!(f.choose(Some("Nightish".into())));
    assert!(!f.choose(Some("Nightish".into())));
    let chosen = f.update();
    assert_eq!((chosen.theme.as_deref(), chosen.scheme), (Some("Nightish"), Some(Scheme::Dark)));
    assert_eq!(token(&chosen, "window-bg"), Some("#1e1e1e"));
    // Missing names fall back to Lecter: Nightish sets no view or headerbar colour.
    assert_eq!(token(&chosen, "view-bg"), None);
    assert_eq!(token(&chosen, "headerbar-bg"), None);
    f.choose(Some("Uninstalled".into()));
    assert_eq!(f.update().theme.as_deref(), Some("Adwaitish"));
    f.choose(None);
    assert_eq!(f.update().theme.as_deref(), Some("Adwaitish"));
}

#[test]
fn the_desktops_accent_replaces_the_themes() {
    let mut f = fixtures();
    f.set_desktop(desktop(Some("Adwaitish"), None, Some(0xe62d42)));
    let update = f.update();
    assert_eq!(token(&update, "accent-bg"), Some("#e62d42"));
    let red = Rgba::from_hex(0xe62d42).standalone(false).to_string();
    assert_eq!(token(&update, "accent"), Some(red.as_str()));
    assert_eq!(update.tokens.iter().filter(|t| t.name.starts_with("accent")).count(), 3, "accent-fg stays the theme's");
    // Without a theme only the accent is set; on a dark desktop its standalone form is light.
    f.set_desktop(desktop(None, Some(Scheme::Dark), Some(0x3584e4)));
    let accent_only = f.update();
    assert_eq!(
        accent_only.tokens.iter().map(|t| (t.name.as_str(), t.value.as_str())).collect::<Vec<_>>(),
        [("accent-bg", "#3584e4"), ("accent", "#81d0ff")]
    );
    assert_eq!(accent_only.theme, None);
}

#[test]
fn an_import_only_or_oversized_theme_applies_nothing() {
    let mut f = fixtures();
    f.set_desktop(desktop(Some("Imported"), Some(Scheme::Light), None));
    assert_eq!(f.update(), ThemeUpdate { theme: Some("Imported".into()), scheme: Some(Scheme::Light), tokens: vec![] });

    let env = TestEnv::new().unwrap();
    let dir = env.home().join("themes/Huge/gtk-3.0");
    std::fs::create_dir_all(&dir).unwrap();
    let mut css = String::from("@define-color theme_bg_color #000000;");
    css.push_str(&" ".repeat(usize::try_from(MAX_CSS_BYTES).unwrap()));
    std::fs::write(dir.join("gtk.css"), css).unwrap();
    let mut f = Follower::new(ThemeDirs::new(vec![env.home().join("themes")], vec![]));
    f.set_desktop(desktop(Some("Huge"), None, None));
    assert_eq!(f.update(), ThemeUpdate { theme: Some("Huge".into()), scheme: None, tokens: vec![] });
}

#[test]
fn a_stylesheet_is_parsed_once_until_it_changes_on_disk() {
    let env = TestEnv::new().unwrap();
    let root = env.home().join("themes");
    let css = root.join("Mine/gtk-3.0/gtk.css");
    std::fs::create_dir_all(css.parent().unwrap()).unwrap();
    std::fs::write(&css, "@define-color theme_bg_color #101010;").unwrap();
    let mut f = Follower::new(ThemeDirs::new(vec![root, fixture("")], vec![]));
    f.set_desktop(desktop(Some("Mine"), None, None));
    assert_eq!(token(&f.update(), "window-bg"), Some("#101010"));
    assert_eq!(f.reads(), 1);
    // Scheme and accent changes reuse the parsed colours.
    f.change(Change::Scheme(Some(Scheme::Dark)));
    f.change(Change::Accent(Some(Rgba::from_hex(0x3a944a))));
    f.update();
    f.update();
    assert_eq!(f.reads(), 1);
    // Switching away and back reads the other theme once and this one not again.
    f.change(Change::Theme(Some("Greyish".into())));
    f.update();
    f.change(Change::Theme(Some("Mine".into())));
    assert_eq!(token(&f.update(), "window-bg"), Some("#101010"));
    assert_eq!(f.reads(), 2);
    // Rewritten with a new modification time: read again.
    std::fs::write(&css, "@define-color theme_bg_color #202020;").unwrap();
    let later = SystemTime::now() + Duration::from_secs(5);
    std::fs::File::options().write(true).open(&css).unwrap().set_modified(later).unwrap();
    assert_eq!(token(&f.update(), "window-bg"), Some("#202020"));
    assert_eq!(f.reads(), 3);
}

#[test]
fn the_cache_keeps_the_four_latest_themes() {
    let mut f = fixtures();
    let themes = ["Adwaitish", "Greyish", "Nightish", "Both", "Variant"];
    for name in themes {
        f.change(Change::Theme(Some(name.into())));
        f.update();
    }
    assert_eq!(f.reads(), 5);
    // The four latest are cached; the first was evicted.
    for name in ["Greyish", "Nightish", "Both", "Variant"] {
        f.change(Change::Theme(Some(name.into())));
        f.update();
    }
    assert_eq!(f.reads(), 5);
    f.change(Change::Theme(Some("Adwaitish".into())));
    f.update();
    assert_eq!(f.reads(), 6);
}

#[test]
fn set_desktop_reports_whether_it_changed() {
    let mut f = fixtures();
    assert!(!f.set_desktop(Desktop::default()));
    assert!(f.set_desktop(desktop(Some("Greyish"), None, None)));
    assert!(!f.set_desktop(desktop(Some("Greyish"), None, None)));
    assert_eq!(f.dirs(), &ThemeDirs::new(vec![fixture("")], vec![]));
}

#[test]
fn ui_theme_is_a_setting_that_defaults_to_following_the_desktop() {
    use crate::settings::{Scope, SettingsStore, Source};
    use serde_json::json;
    let env = TestEnv::new().unwrap();
    let store = SettingsStore::open(&env.dirs(), None);
    assert_eq!(store.settings().ui.theme, None);
    assert_eq!(store.get("ui.theme").map(|r| (r.value, r.source)), Some((json!(null), Source::Default)));
    store.set(Scope::Global, "ui.theme", json!("Greyish")).unwrap();
    assert_eq!(store.settings().ui.theme.as_deref(), Some("Greyish"));
    assert!(store.set(Scope::Global, "ui.theme", json!(3)).is_err());
    let mut f = fixtures();
    f.choose(store.settings().ui.theme);
    assert_eq!(f.update().theme.as_deref(), Some("Greyish"));
}
