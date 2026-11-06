use std::path::PathBuf;

use lecter_core::theme::gtk::desktop::Desktop;
use lecter_core::theme::gtk::tokens::Scheme;

use super::*;

fn fixtures() -> Themes {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/gtk-themes");
    Themes::new(ThemeDirs::new(vec![dir], vec![]), Tools::default())
}

/// The contract (18-contracts.md#ipc, area `theme`): neither command takes anything from the UI.
#[test]
fn the_theme_commands_take_nothing_and_the_event_is_named_by_area() {
    let contract = super::super::contract();
    let args = |name| crate::export::command_args(&contract, name);
    assert_eq!(args("theme_get"), Some(vec![]));
    assert_eq!(args("theme_list"), Some(vec![]));
    assert_eq!(<ThemeChanged as tauri_specta::Event>::NAME, "theme:changed");
}

#[test]
fn an_update_is_sent_only_when_it_differs_from_the_last() {
    let themes = fixtures();
    // Nothing applies yet, and nothing was sent: the empty update is new.
    assert_eq!(themes.changed(), Some(ThemeUpdate::default()));
    assert_eq!(themes.changed(), None);
    themes.with(|s| s.follower.set_desktop(Desktop { theme: Some("Nightish".into()), ..Desktop::default() }));
    let night = themes.changed().unwrap();
    assert_eq!((night.theme.as_deref(), night.scheme), (Some("Nightish"), Some(Scheme::Dark)));
    assert_eq!(themes.changed(), None);
    // What theme_get answers counts as sent.
    themes.with(|s| s.follower.choose(Some("Greyish".into())));
    assert_eq!(themes.current().theme.as_deref(), Some("Greyish"));
    assert_eq!(themes.changed(), None);
}

#[test]
fn the_list_is_the_installed_themes() {
    let names: Vec<String> = fixtures().list().into_iter().map(|t| t.name).collect();
    assert_eq!(names, ["Adwaitish", "Both", "Greyish", "Imported", "Nightish", "Variant"]);
}
