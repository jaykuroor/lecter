//! The desktop's appearance: GTK theme name, colour scheme and accent, as the XDG settings portal
//! (`org.freedesktop.appearance`, plus GNOME's `org.gnome.desktop.interface` namespace for the
//! theme name) or `gsettings` report them (12-settings-theme-onboarding.md#theme). The text comes
//! from `gdbus` and `gsettings`, read with [`gvariant`](super::gvariant).

use super::color::Rgba;
use super::gvariant::{self, Value};
use super::tokens::Scheme;

/// The portal's appearance namespace.
pub const APPEARANCE: &str = "org.freedesktop.appearance";
/// GNOME's interface settings (gsettings schema and portal namespace).
pub const INTERFACE: &str = "org.gnome.desktop.interface";

/// libadwaita's accent presets, as GNOME's `accent-color` setting names them.
const ACCENTS: [(&str, u32); 9] = [
    ("blue", 0x3584e4),
    ("teal", 0x2190a4),
    ("green", 0x3a944a),
    ("yellow", 0xc88800),
    ("orange", 0xed5b00),
    ("red", 0xe62d42),
    ("pink", 0xd56199),
    ("purple", 0x9141ac),
    ("slate", 0x6f8396),
];

/// What the desktop says about its look; `None` where it says nothing.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Desktop {
    /// The GTK theme's name (`gtk-theme`).
    pub theme: Option<String>,
    /// The preferred scheme; `None` is "no preference".
    pub scheme: Option<Scheme>,
    /// The accent colour.
    pub accent: Option<Rgba>,
}

/// One setting the desktop changed.
#[derive(Debug, Clone, PartialEq)]
pub enum Change {
    /// A new theme name (`None`: unset).
    Theme(Option<String>),
    /// A new scheme preference.
    Scheme(Option<Scheme>),
    /// A new accent (`None`: unset).
    Accent(Option<Rgba>),
}

impl Desktop {
    /// Applies `change`; whether anything changed.
    pub fn apply(&mut self, change: Change) -> bool {
        let before = self.clone();
        match change {
            Change::Theme(t) => self.theme = t,
            Change::Scheme(s) => self.scheme = s,
            Change::Accent(a) => self.accent = a,
        }
        *self != before
    }
}

/// The change one portal setting stands for, from its namespace, key and value; `None` for a
/// setting Lecter doesn't follow or a value it can't read.
pub fn setting(namespace: &str, key: &str, value: &Value) -> Option<Change> {
    match (namespace, key) {
        (APPEARANCE, "color-scheme") => match value {
            Value::Num(n) if *n == 1.0 => Some(Change::Scheme(Some(Scheme::Dark))),
            Value::Num(n) if *n == 2.0 => Some(Change::Scheme(Some(Scheme::Light))),
            Value::Num(_) => Some(Change::Scheme(None)),
            _ => None,
        },
        (APPEARANCE, "accent-color") => match value {
            // Values outside 0..=1 mean "no accent" (the portal's documentation).
            Value::List(rgb) => match rgb.as_slice() {
                [Value::Num(r), Value::Num(g), Value::Num(b)] => {
                    let unit = |x: f64| (0.0..=1.0).contains(&x);
                    let set = unit(*r) && unit(*g) && unit(*b);
                    Some(Change::Accent(set.then(|| Rgba::new(*r, *g, *b, 1.0))))
                }
                _ => None,
            },
            _ => None,
        },
        (INTERFACE, "gtk-theme") => {
            let name = value.as_str()?.trim();
            Some(Change::Theme((!name.is_empty()).then(|| name.to_owned())))
        }
        (INTERFACE, "color-scheme") => match value.as_str()? {
            "prefer-dark" => Some(Change::Scheme(Some(Scheme::Dark))),
            "prefer-light" => Some(Change::Scheme(Some(Scheme::Light))),
            _ => Some(Change::Scheme(None)),
        },
        (INTERFACE, "accent-color") => {
            let name = value.as_str()?;
            Some(Change::Accent(ACCENTS.iter().find(|(n, _)| *n == name).map(|&(_, hex)| Rgba::from_hex(hex))))
        }
        _ => None,
    }
}

/// The desktop as the portal's `ReadAll` answer gives it (`gdbus call … ReadAll`); `None` when
/// the text isn't such an answer. Appearance settings win over the interface namespace's.
pub fn read_all(text: &str) -> Option<Desktop> {
    let answer = gvariant::parse(text.trim())?;
    let Value::List(items) = answer else { return None };
    let namespaces = items.first()?;
    if !matches!(namespaces, Value::Dict(_)) {
        return None;
    }
    let mut desktop = Desktop::default();
    for wanted in [INTERFACE, APPEARANCE] {
        let Some(Value::Dict(keys)) = namespaces.get(wanted) else { continue };
        for (key, value) in keys {
            if let Some(change) = key.as_str().and_then(|k| setting(wanted, k, value)) {
                desktop.apply(change);
            }
        }
    }
    Some(desktop)
}

/// The change a `gdbus monitor` line reports: a `SettingChanged` signal of a setting Lecter
/// follows; `None` for any other line.
pub fn signal(line: &str) -> Option<Change> {
    let (_, args) = line.split_once("org.freedesktop.portal.Settings.SettingChanged ")?;
    let Value::List(items) = gvariant::parse(args)? else { return None };
    match items.as_slice() {
        [Value::Str(namespace), Value::Str(key), value] => setting(namespace, key, value),
        _ => None,
    }
}

/// The change one `gsettings get org.gnome.desktop.interface <key>` answer stands for.
pub fn gsettings_value(key: &str, text: &str) -> Option<Change> {
    setting(INTERFACE, key, &gvariant::parse(text.trim())?)
}

/// The change a `gsettings monitor org.gnome.desktop.interface` line (`key: value`) reports.
pub fn gsettings_line(line: &str) -> Option<Change> {
    let (key, value) = line.split_once(':')?;
    gsettings_value(key.trim(), value)
}

#[cfg(test)]
#[path = "desktop_tests.rs"]
mod tests;
