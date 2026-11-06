#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::collections::HashMap;
use std::path::Path;

use super::*;
use crate::testenv::TestEnv;
use crate::theme::gtk::color::Rgba;
use crate::theme::gtk::desktop::{Change, Desktop};
use crate::theme::gtk::follow::{Follower, ThemeUpdate};
use crate::theme::gtk::tokens::{DIRECT, GLOSS, to_css};

/// The themes the spec names (12-settings-theme-onboarding.md#theme).
const SPEC: [&str; 6] = ["Adwaita", "Yaru", "Breeze", "Catppuccin", "Gruvbox", "Nord"];

fn tokens(name: &str, scheme: Scheme) -> HashMap<String, String> {
    let b = Bundled::find(name).unwrap();
    to_css(&b.colors(scheme).tokens(scheme)).into_iter().map(|t| (t.name, t.value)).collect()
}

fn token<'a>(update: &'a ThemeUpdate, name: &str) -> Option<&'a str> {
    update.tokens.iter().find(|t| t.name == name).map(|t| t.value.as_str())
}

fn bundled_follower(dirs: ThemeDirs) -> Follower {
    let mut f = Follower::new(dirs);
    f.offer_bundled();
    f
}

fn no_dirs() -> ThemeDirs {
    ThemeDirs::new(vec![], vec![])
}

#[test]
fn the_spec_themes_are_bundled_in_its_order() {
    let names: Vec<&str> = PALETTES.iter().map(|p| p.name).collect();
    assert_eq!(names, SPEC);
}

#[test]
fn every_variant_sets_every_colour_token_and_reads_as_its_scheme() {
    for palette in &PALETTES {
        for scheme in [Scheme::Light, Scheme::Dark] {
            let colors = Bundled { palette, pinned: None }.colors(scheme);
            assert_eq!(colors.scheme(), Some(scheme), "{} {scheme:?}", palette.name);
            let set: Vec<&str> = colors.tokens(scheme).iter().map(|(n, _)| *n).collect();
            for (token, _) in DIRECT {
                assert!(set.contains(&token), "{} {scheme:?} lacks {token}", palette.name);
            }
            for (token, _, _) in GLOSS {
                assert!(set.contains(&token), "{} {scheme:?} lacks {token}", palette.name);
            }
            for token in ["dim", "faint", "borders", "line2"] {
                assert!(set.contains(&token), "{} {scheme:?} lacks {token}", palette.name);
            }
        }
    }
}

#[test]
fn variants_carry_their_projects_published_colours() {
    // Catppuccin Latte and Mocha.
    let latte = tokens("Catppuccin", Scheme::Light);
    assert_eq!(latte["view-bg"], "#eff1f5");
    assert_eq!(latte["window-fg"], "#4c4f69");
    assert_eq!(latte["k-derive"], "#1e66f5");
    let mocha = tokens("Catppuccin", Scheme::Dark);
    assert_eq!(mocha["view-bg"], "#1e1e2e");
    assert_eq!(mocha["k-ask"], "#a6e3a1");
    // Gruvbox: faded colours on light, bright on dark.
    assert_eq!(tokens("Gruvbox", Scheme::Light)["k-prof"], "#9d0006");
    let gruvbox = tokens("Gruvbox", Scheme::Dark);
    assert_eq!(gruvbox["window-bg"], "#282828");
    assert_eq!(gruvbox["k-doubt"], "#fabd2f");
    // Nord: Polar Night, Frost and Aurora.
    let nord = tokens("Nord", Scheme::Dark);
    assert_eq!(nord["view-bg"], "#2e3440");
    assert_eq!(nord["accent-bg"], "#88c0d0");
    assert_eq!(nord["k-later"], "#d08770");
    // Adwaita: libadwaita's surfaces and the GNOME palette.
    let adwaita = tokens("Adwaita", Scheme::Light);
    assert_eq!(adwaita["window-bg"], "#fafafb");
    assert_eq!(adwaita["accent-bg"], "#3584e4");
    assert_eq!(adwaita["k-derive"], "#1c71d8");
    assert_eq!(tokens("Adwaita", Scheme::Dark)["k-source"], "#dc8add");
    // Yaru's Ubuntu orange; Breeze's Plasma blue.
    assert_eq!(tokens("Yaru", Scheme::Dark)["accent-bg"], "#e95420");
    assert_eq!(tokens("Breeze", Scheme::Light)["accent-bg"], "#3daee9");
    assert_eq!(tokens("Breeze", Scheme::Dark)["window-bg"], "#31363b");
}

#[test]
fn a_two_name_gloss_colour_is_the_even_mix() {
    // k-write is mix(blue_4, green_4): Nord light #5e81ac and #8fbcbb → #779fb4 (rounded).
    let nord = tokens("Nord", Scheme::Light);
    let mix = Rgba::from_hex(0x5e81ac).mix(Rgba::from_hex(0x8fbcbb), 0.5).to_string();
    assert_eq!(nord["k-write"], mix);
    assert_ne!(nord["k-write"], "#5e81ac");
}

#[test]
fn names_pin_a_variant_with_a_suffix() {
    let nord = Bundled::find("Nord").unwrap();
    assert_eq!((nord.palette.name, nord.pinned), ("Nord", None));
    assert_eq!(Bundled::find("Nord-dark").unwrap().pinned, Some(Scheme::Dark));
    assert_eq!(Bundled::find("Nord-light").unwrap().pinned, Some(Scheme::Light));
    assert_eq!(Bundled::find("Gruvbox-dark").unwrap().palette.name, "Gruvbox");
    for wrong in ["nord", "NORD", "Nord-Dark", "Nord-dark-dark", "Nord ", "-dark", "", "Solarized", "Nordic"] {
        assert_eq!(Bundled::find(wrong), None, "{wrong:?}");
    }
}

#[test]
fn the_unpinned_name_follows_the_os_and_defaults_to_light() {
    let nord = Bundled::find("Nord").unwrap();
    assert_eq!(nord.scheme(Some(Scheme::Dark)), Scheme::Dark);
    assert_eq!(nord.scheme(Some(Scheme::Light)), Scheme::Light);
    assert_eq!(nord.scheme(None), Scheme::Light);
    let dark = Bundled::find("Nord-dark").unwrap();
    assert_eq!(dark.scheme(Some(Scheme::Light)), Scheme::Dark);
    assert_eq!(dark.scheme(None), Scheme::Dark);
    assert_eq!(Bundled::find("Nord-light").unwrap().scheme(Some(Scheme::Dark)), Scheme::Light);
}

#[test]
fn eighteen_names_are_offered() {
    let names: Vec<String> = names().collect();
    assert_eq!(names.len(), 18);
    assert_eq!(&names[..3], ["Adwaita", "Adwaita-light", "Adwaita-dark"]);
    for theme in SPEC {
        for name in [theme.to_owned(), format!("{theme}-light"), format!("{theme}-dark")] {
            assert!(names.contains(&name), "{name}");
            assert!(Bundled::find(&name).is_some(), "{name}");
        }
    }
}

#[test]
fn offered_beside_installed_themes_an_installed_name_wins_and_all_are_sorted() {
    let installed = vec![
        InstalledTheme { name: "Nord".into(), folder: "/home/u/.themes".into() },
        InstalledTheme { name: "Arc".into(), folder: "/home/u/.themes".into() },
    ];
    let list = offer(installed);
    assert_eq!(list.len(), 2 + 17);
    let nord: Vec<&InstalledTheme> = list.iter().filter(|t| t.name == "Nord").collect();
    assert_eq!(nord, [&InstalledTheme { name: "Nord".into(), folder: "/home/u/.themes".into() }]);
    assert_eq!(list.iter().find(|t| t.name == "Nord-dark").map(|t| t.folder.as_str()), Some(""));
    let names: Vec<&str> = list.iter().map(|t| t.name.as_str()).collect();
    assert_eq!(&names[..4], ["Adwaita", "Adwaita-dark", "Adwaita-light", "Arc"]);
    assert_eq!(names.last(), Some(&"Yaru-light"));
}

#[test]
fn offering_stops_at_the_list_limit() {
    let full: Vec<InstalledTheme> =
        (0..MAX_THEMES).map(|i| InstalledTheme { name: format!("T{i:04}"), folder: "/t".into() }).collect();
    let list = offer(full);
    assert_eq!(list.len(), MAX_THEMES);
    assert!(list.iter().all(|t| !t.folder.is_empty()));
    let one_short: Vec<InstalledTheme> =
        (1..MAX_THEMES).map(|i| InstalledTheme { name: format!("T{i:04}"), folder: "/t".into() }).collect();
    let list = offer(one_short);
    assert_eq!(list.len(), MAX_THEMES);
    assert_eq!(list.iter().filter(|t| t.folder.is_empty()).count(), 1);
}

#[test]
fn the_user_theme_folder_is_dot_themes_in_home_or_the_windows_profile() {
    let env_of = |pairs: &'static [(&'static str, &'static str)]| {
        move |k: &str| pairs.iter().find(|(n, _)| *n == k).map(|(_, v)| OsString::from(v))
    };
    let expect = |p: &str| ThemeDirs::new(vec![PathBuf::from(p).join(".themes")], vec![]);
    assert_eq!(user_dirs(env_of(&[("HOME", "/Users/ada")])), expect("/Users/ada"));
    assert_eq!(user_dirs(env_of(&[("USERPROFILE", r"C:\Users\ada")])), expect(r"C:\Users\ada"));
    assert_eq!(user_dirs(env_of(&[("HOME", "/h"), ("USERPROFILE", "/p")])), expect("/h"));
    assert_eq!(user_dirs(env_of(&[("HOME", ""), ("USERPROFILE", "/p")])), expect("/p"));
    assert_eq!(user_dirs(env_of(&[])), no_dirs());
}

#[test]
fn choosing_a_bundled_theme_applies_its_variant_for_the_os_scheme() {
    let mut f = bundled_follower(no_dirs());
    f.choose(Some("Nord".into()));
    let light = f.update();
    assert_eq!((light.theme.as_deref(), light.scheme), (Some("Nord"), Some(Scheme::Light)));
    assert_eq!(token(&light, "window-bg"), Some("#e5e9f0"));
    assert_eq!(f.stylesheet(), None);
    assert_eq!(f.reads(), 0);
    f.change(Change::Scheme(Some(Scheme::Dark)));
    let dark = f.update();
    assert_eq!((dark.scheme, token(&dark, "window-bg")), (Some(Scheme::Dark), Some("#3b4252")));
    assert_eq!(token(&dark, "k-derive"), Some("#81a1c1"));
    f.choose(Some("Catppuccin-light".into()));
    let pinned = f.update();
    assert_eq!((pinned.theme.as_deref(), pinned.scheme), (Some("Catppuccin-light"), Some(Scheme::Light)));
    assert_eq!(token(&pinned, "view-bg"), Some("#eff1f5"));
}

#[test]
fn the_os_accent_wins_over_a_bundled_themes_own() {
    let mut f = bundled_follower(no_dirs());
    f.choose(Some("Gruvbox-dark".into()));
    assert_eq!(token(&f.update(), "accent-bg"), Some("#83a598"));
    f.change(Change::Accent(Some(Rgba::from_hex(0x62ba46))));
    let update = f.update();
    assert_eq!(token(&update, "accent-bg"), Some("#62ba46"));
    assert_eq!(update.tokens.iter().filter(|t| t.name == "accent-bg").count(), 1);
    assert_eq!(token(&update, "accent"), Some(Rgba::from_hex(0x62ba46).standalone(true).to_string().as_str()));
}

#[test]
fn without_the_offer_a_bundled_name_applies_nothing() {
    let mut f = Follower::new(no_dirs());
    assert!(!f.offers_bundled());
    assert!(bundled_follower(no_dirs()).offers_bundled());
    f.choose(Some("Nord-dark".into()));
    assert_eq!(f.update(), ThemeUpdate::default());
    f.set_desktop(Desktop { theme: Some("Nord".into()), scheme: None, accent: None });
    assert_eq!(f.update().theme, None);
}

#[test]
fn the_desktops_theme_name_never_picks_a_bundled_theme() {
    let mut f = bundled_follower(no_dirs());
    f.set_desktop(Desktop { theme: Some("Nord".into()), scheme: Some(Scheme::Dark), accent: None });
    assert_eq!(f.update(), ThemeUpdate { theme: None, scheme: Some(Scheme::Dark), tokens: vec![] });
}

fn gtk_theme(root: &Path, name: &str, css: &str) {
    let dir = root.join(name).join("gtk-3.0");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("gtk.css"), css).unwrap();
}

#[test]
fn a_theme_folder_in_dot_themes_is_offered_and_wins_over_a_bundled_name() {
    let env = TestEnv::new().unwrap();
    let home = env.home().join("home");
    let themes = home.join(".themes");
    gtk_theme(&themes, "Nord", "@define-color theme_bg_color #102030;");
    gtk_theme(&themes, "Mine", "@define-color theme_bg_color #f0e0d0;");
    let home_os = home.clone().into_os_string();
    let dirs = user_dirs(move |k| (k == "HOME").then(|| home_os.clone()));
    let list = offer(dirs.list());
    let folder = themes.display().to_string();
    assert!(list.contains(&InstalledTheme { name: "Mine".into(), folder: folder.clone() }));
    assert!(list.contains(&InstalledTheme { name: "Nord".into(), folder }));
    assert_eq!(list.len(), 2 + 17);
    let mut f = bundled_follower(dirs);
    f.choose(Some("Mine".into()));
    assert_eq!(token(&f.update(), "window-bg"), Some("#f0e0d0"));
    f.choose(Some("Nord".into()));
    let nord = f.update();
    assert_eq!(token(&nord, "window-bg"), Some("#102030"));
    assert_eq!(f.stylesheet(), Some(themes.join("Nord/gtk-3.0/gtk.css").as_path()));
    f.choose(Some("Nord-dark".into()));
    assert_eq!(token(&f.update(), "window-bg"), Some("#3b4252"));
}
