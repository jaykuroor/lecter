//! The OS accent colour on macOS and Windows (12-settings-theme-onboarding.md#theme). Read with
//! the OS's own command-line tools, as the Linux desktop is (D-245): no native bindings.
//!
//! - macOS: `defaults read -g AppleAccentColor`, an integer for System Settings → Appearance →
//!   Accent colour. With no value set ("Multicolour") each app uses its own accent, so Lecter's.
//! - Windows: `reg query` of `AccentColorMenu` (Settings → Personalisation → Colours), else DWM's
//!   `AccentColor`; both a `REG_DWORD` in `0xAABBGGRR` order.
//!
//! Reads are bounded (timeout, output cap) and blocking-free; the shell re-reads on its window's
//! focus and theme events, never on a timer (D-237).

use std::ffi::OsString;

use super::gtk::color::Rgba;
use super::gtk::monitor::output;

/// macOS's accent colours by `AppleAccentColor` value (NSColor.controlAccentColor, sRGB).
const MACOS: [(i32, u32); 8] = [
    (-1, 0x989898), // Graphite
    (0, 0xe0383e),  // Red
    (1, 0xf7821b),  // Orange
    (2, 0xffc726),  // Yellow
    (3, 0x62ba46),  // Green
    (4, 0x007aff),  // Blue
    (5, 0x953d96),  // Purple
    (6, 0xf74f9e),  // Pink
];

/// The Windows registry values read, in order: (key, value name).
pub const WINDOWS_VALUES: [(&str, &str); 2] = [
    (r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Accent", "AccentColorMenu"),
    (r"HKCU\Software\Microsoft\Windows\DWM", "AccentColor"),
];

/// Which OS's tools to ask.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    /// `defaults`.
    MacOs,
    /// `reg`.
    Windows,
}

impl Os {
    /// The OS this build runs on, when it is one that reads its accent here.
    pub fn current() -> Option<Self> {
        if cfg!(target_os = "macos") {
            Some(Self::MacOs)
        } else if cfg!(windows) {
            Some(Self::Windows)
        } else {
            None
        }
    }
}

/// The programs used; tests point them at fakes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccentTools {
    /// macOS's `defaults`.
    pub defaults: OsString,
    /// Windows's `reg`.
    pub reg: OsString,
}

impl Default for AccentTools {
    fn default() -> Self {
        Self { defaults: "defaults".into(), reg: "reg".into() }
    }
}

/// The accent a `defaults read -g AppleAccentColor` answer names; `None` for anything else.
pub fn macos(text: &str) -> Option<Rgba> {
    let value: i32 = text.trim().parse().ok()?;
    MACOS.iter().find(|(v, _)| *v == value).map(|&(_, hex)| Rgba::from_hex(hex))
}

/// The accent in a `reg query <key> /v <name>` answer: the `REG_DWORD` on the line naming
/// `name`, read as `0xAABBGGRR` (alpha ignored); `None` when there is none.
pub fn windows(text: &str, name: &str) -> Option<Rgba> {
    text.lines().find_map(|line| {
        let mut words = line.split_whitespace();
        if !words.next()?.eq_ignore_ascii_case(name) || words.next()? != "REG_DWORD" {
            return None;
        }
        let digits = words.next()?;
        let digits = digits.strip_prefix("0x").or_else(|| digits.strip_prefix("0X"))?;
        let abgr = u32::from_str_radix(digits, 16).ok()?;
        let (r, g, b) = (abgr & 0xff, (abgr >> 8) & 0xff, (abgr >> 16) & 0xff);
        Some(Rgba::from_hex((r << 16) | (g << 8) | b))
    })
}

/// The OS accent now; `None` when the OS sets none (or Lecter's should apply) or it can't be
/// read. Call from an async runtime worker thread.
pub async fn read(os: Os, tools: &AccentTools) -> Option<Rgba> {
    match os {
        Os::MacOs => macos(&output(&tools.defaults, &["read", "-g", "AppleAccentColor"]).await?),
        Os::Windows => {
            for (key, name) in WINDOWS_VALUES {
                if let Some(accent) = output(&tools.reg, &["query", key, "/v", name]).await.and_then(|t| windows(&t, name))
                {
                    return Some(accent);
                }
            }
            None
        }
    }
}

#[cfg(test)]
#[path = "accent_tests.rs"]
mod tests;
