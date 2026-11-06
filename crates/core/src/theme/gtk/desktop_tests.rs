use super::*;

/// `gdbus call … org.freedesktop.portal.Settings.ReadAll` on GNOME, as g_variant_print writes it.
const READ_ALL: &str = "({'org.freedesktop.appearance': {'color-scheme': <uint32 1>, \
    'accent-color': <(0.20784313976764679, 0.51764708757400513, 0.89411765336990356)>, 'contrast': <uint32 0>}, \
    'org.gnome.desktop.interface': {'gtk-theme': <'Adwaita'>, 'color-scheme': <'prefer-light'>, \
    'accent-color': <'teal'>, 'font-name': <'Adwaita Sans 11'>, 'cursor-size': <24>, \
    'enable-animations': <true>, 'text-scaling-factor': <1.0>}},)\n";

#[test]
fn read_all_takes_the_theme_and_lets_appearance_win() {
    let desktop = read_all(READ_ALL).unwrap();
    assert_eq!(desktop.theme.as_deref(), Some("Adwaita"));
    // The appearance namespace's scheme (1, dark) and RGB accent beat GNOME's own keys.
    assert_eq!(desktop.scheme, Some(Scheme::Dark));
    assert_eq!(desktop.accent.map(|c| c.to_string()).as_deref(), Some("#3584e4"));
}

#[test]
fn read_all_with_only_one_namespace_reads_what_is_there() {
    let kde = "({'org.freedesktop.appearance': {'color-scheme': <uint32 2>}},)";
    assert_eq!(read_all(kde), Some(Desktop { theme: None, scheme: Some(Scheme::Light), accent: None }));
    let gnome_only = "({'org.gnome.desktop.interface': {'gtk-theme': <'Arc'>, 'accent-color': <'slate'>}},)";
    let desktop = read_all(gnome_only).unwrap();
    assert_eq!(desktop.theme.as_deref(), Some("Arc"));
    assert_eq!(desktop.accent.map(|c| c.to_string()).as_deref(), Some("#6f8396"));
    assert_eq!(read_all("(@a{sa{sv}} {},)"), Some(Desktop::default()));
}

#[test]
fn read_all_refuses_text_that_is_not_an_answer() {
    for bad in ["", "Error: GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown", "('x',)", "{'a': 1}", "()"] {
        assert_eq!(read_all(bad), None, "{bad:?}");
    }
}

#[test]
fn colour_scheme_numbers_and_names_map_to_schemes() {
    let n = |x: f64| setting(APPEARANCE, "color-scheme", &Value::Num(x));
    assert_eq!(n(0.0), Some(Change::Scheme(None)));
    assert_eq!(n(1.0), Some(Change::Scheme(Some(Scheme::Dark))));
    assert_eq!(n(2.0), Some(Change::Scheme(Some(Scheme::Light))));
    assert_eq!(n(7.0), Some(Change::Scheme(None)));
    assert_eq!(setting(APPEARANCE, "color-scheme", &Value::Str("1".into())), None);
    let s = |x: &str| setting(INTERFACE, "color-scheme", &Value::Str(x.into()));
    assert_eq!(s("prefer-dark"), Some(Change::Scheme(Some(Scheme::Dark))));
    assert_eq!(s("prefer-light"), Some(Change::Scheme(Some(Scheme::Light))));
    assert_eq!(s("default"), Some(Change::Scheme(None)));
    assert_eq!(setting(INTERFACE, "color-scheme", &Value::Num(1.0)), None);
}

#[test]
fn portal_accents_outside_the_unit_range_mean_none() {
    let rgb = |r: f64, g: f64, b: f64| {
        setting(APPEARANCE, "accent-color", &Value::List(vec![Value::Num(r), Value::Num(g), Value::Num(b)]))
    };
    assert_eq!(rgb(1.0, 0.0, 0.0), Some(Change::Accent(Some(Rgba::from_hex(0xff0000)))));
    assert_eq!(rgb(0.0, 0.0, 0.0), Some(Change::Accent(Some(Rgba::from_hex(0x000000)))));
    assert_eq!(rgb(-1.0, -1.0, -1.0), Some(Change::Accent(None)));
    assert_eq!(rgb(0.5, 1.5, 0.5), Some(Change::Accent(None)));
    assert_eq!(rgb(0.5, 0.5, 1.01), Some(Change::Accent(None)));
    assert_eq!(setting(APPEARANCE, "accent-color", &Value::List(vec![Value::Num(1.0)])), None);
    assert_eq!(setting(APPEARANCE, "accent-color", &Value::Str("blue".into())), None);
}

#[test]
fn gnome_accent_names_map_to_libadwaitas_presets() {
    let named = |x: &str| match setting(INTERFACE, "accent-color", &Value::Str(x.into())) {
        Some(Change::Accent(c)) => c.map(|c| c.to_string()),
        other => panic!("{other:?}"),
    };
    assert_eq!(named("blue").as_deref(), Some("#3584e4"));
    assert_eq!(named("teal").as_deref(), Some("#2190a4"));
    assert_eq!(named("green").as_deref(), Some("#3a944a"));
    assert_eq!(named("yellow").as_deref(), Some("#c88800"));
    assert_eq!(named("orange").as_deref(), Some("#ed5b00"));
    assert_eq!(named("red").as_deref(), Some("#e62d42"));
    assert_eq!(named("pink").as_deref(), Some("#d56199"));
    assert_eq!(named("purple").as_deref(), Some("#9141ac"));
    assert_eq!(named("slate").as_deref(), Some("#6f8396"));
    assert_eq!(named("chartreuse"), None);
}

#[test]
fn theme_names_are_trimmed_and_empty_means_unset() {
    let t = |x: &str| setting(INTERFACE, "gtk-theme", &Value::Str(x.into()));
    assert_eq!(t(" Arc-Dark "), Some(Change::Theme(Some("Arc-Dark".into()))));
    assert_eq!(t(""), Some(Change::Theme(None)));
    assert_eq!(setting(INTERFACE, "gtk-theme", &Value::Num(1.0)), None);
    assert_eq!(setting(INTERFACE, "icon-theme", &Value::Str("Papirus".into())), None);
    assert_eq!(setting("org.kde.kdeglobals.General", "ColorScheme", &Value::Str("Breeze".into())), None);
}

#[test]
fn monitor_lines_report_setting_changed_signals_only() {
    let line = "/org/freedesktop/portal/desktop: org.freedesktop.portal.Settings.SettingChanged \
                ('org.gnome.desktop.interface', 'gtk-theme', <'Arc-Dark'>)";
    assert_eq!(signal(line), Some(Change::Theme(Some("Arc-Dark".into()))));
    let scheme = "/org/freedesktop/portal/desktop: org.freedesktop.portal.Settings.SettingChanged \
                  ('org.freedesktop.appearance', 'color-scheme', <uint32 2>)";
    assert_eq!(signal(scheme), Some(Change::Scheme(Some(Scheme::Light))));
    for other in [
        "Monitoring signals on object /org/freedesktop/portal/desktop owned by org.freedesktop.portal.Desktop",
        "The name org.freedesktop.portal.Desktop is owned by :1.23",
        "/org/freedesktop/portal/desktop: org.freedesktop.portal.Settings.SettingChanged ('ns', 'key')",
        "/org/freedesktop/portal/desktop: org.freedesktop.portal.Settings.SettingChanged (broken",
        "/org/freedesktop/portal/desktop: org.freedesktop.portal.Settings.SettingChanged \
         ('org.gnome.desktop.interface', 'font-name', <'Sans 11'>)",
    ] {
        assert_eq!(signal(other), None, "{other}");
    }
}

#[test]
fn gsettings_answers_and_monitor_lines_map_to_changes() {
    assert_eq!(gsettings_value("gtk-theme", "'Adwaita-dark'\n"), Some(Change::Theme(Some("Adwaita-dark".into()))));
    assert_eq!(gsettings_value("color-scheme", "'prefer-dark'"), Some(Change::Scheme(Some(Scheme::Dark))));
    assert_eq!(gsettings_value("accent-color", "'yellow'"), Some(Change::Accent(Some(Rgba::from_hex(0xc88800)))));
    assert_eq!(gsettings_value("gtk-theme", "No such key “gtk-theme”"), None);
    assert_eq!(gsettings_line("gtk-theme: 'Yaru'"), Some(Change::Theme(Some("Yaru".into()))));
    assert_eq!(gsettings_line("color-scheme: 'default'"), Some(Change::Scheme(None)));
    assert_eq!(gsettings_line("cursor-size: 24"), None);
    assert_eq!(gsettings_line("no colon here"), None);
}

#[test]
fn applying_a_change_reports_whether_anything_moved() {
    let mut desktop = Desktop::default();
    assert!(desktop.apply(Change::Theme(Some("Arc".into()))));
    assert!(!desktop.apply(Change::Theme(Some("Arc".into()))));
    assert!(desktop.apply(Change::Scheme(Some(Scheme::Dark))));
    assert!(!desktop.apply(Change::Scheme(Some(Scheme::Dark))));
    assert!(desktop.apply(Change::Accent(Some(Rgba::from_hex(0x3584e4)))));
    assert!(desktop.apply(Change::Accent(None)));
    assert_eq!(desktop, Desktop { theme: Some("Arc".into()), scheme: Some(Scheme::Dark), accent: None });
}
