//! Colours as GTK's CSS computes them: sRGB with alpha, and the colour functions themes use in
//! `@define-color` (`shade`, `alpha`, `mix`, `lighter`, `darker`). A colour leaves this module
//! only as text it formats itself from its numbers (`#rrggbb` or `rgba(…)`), so nothing a theme
//! wrote reaches the UI's CSS verbatim (13-security.md, untrusted input).

use std::fmt;

/// An sRGB colour with alpha; every channel is in `0.0..=1.0`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rgba {
    /// Red.
    pub r: f64,
    /// Green.
    pub g: f64,
    /// Blue.
    pub b: f64,
    /// Opacity: 0 transparent, 1 opaque.
    pub a: f64,
}

/// The CSS named colours real GTK themes use in `@define-color` (measured over 55 themes:
/// `black`, `white`, `grey`, `transparent`, `green`), plus the rest of CSS's basic colours.
const NAMED: [(&str, u32); 20] = [
    ("black", 0x000000),
    ("silver", 0xc0c0c0),
    ("gray", 0x808080),
    ("grey", 0x808080),
    ("white", 0xffffff),
    ("maroon", 0x800000),
    ("red", 0xff0000),
    ("purple", 0x800080),
    ("fuchsia", 0xff00ff),
    ("magenta", 0xff00ff),
    ("green", 0x008000),
    ("lime", 0x00ff00),
    ("olive", 0x808000),
    ("yellow", 0xffff00),
    ("navy", 0x000080),
    ("blue", 0x0000ff),
    ("teal", 0x008080),
    ("aqua", 0x00ffff),
    ("cyan", 0x00ffff),
    ("orange", 0xffa500),
];

impl Rgba {
    /// An opaque colour from `0xrrggbb`.
    pub const fn from_hex(rgb: u32) -> Self {
        Self {
            r: ((rgb >> 16) & 0xff) as f64 / 255.0,
            g: ((rgb >> 8) & 0xff) as f64 / 255.0,
            b: (rgb & 0xff) as f64 / 255.0,
            a: 1.0,
        }
    }

    /// A colour from channels, each clamped into `0..=1` (NaN becomes 0).
    pub fn new(r: f64, g: f64, b: f64, a: f64) -> Self {
        Self { r: unit(r), g: unit(g), b: unit(b), a: unit(a) }
    }

    /// A CSS named colour (ASCII case-insensitive), or `transparent`.
    pub fn named(name: &str) -> Option<Self> {
        if name.eq_ignore_ascii_case("transparent") {
            return Some(Self { r: 0.0, g: 0.0, b: 0.0, a: 0.0 });
        }
        NAMED.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|&(_, hex)| Self::from_hex(hex))
    }

    /// `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` (the text after `#`).
    pub fn from_hash(digits: &str) -> Option<Self> {
        if !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        let nibble = |i: usize| digits.get(i..=i).and_then(|d| u8::from_str_radix(d, 16).ok());
        let byte = |i: usize| digits.get(i..i + 2).and_then(|d| u8::from_str_radix(d, 16).ok());
        let short = |i: usize| nibble(i).map(|n| f64::from(n * 17) / 255.0);
        let long = |i: usize| byte(i).map(|n| f64::from(n) / 255.0);
        let (r, g, b, a) = match digits.len() {
            3 => (short(0)?, short(1)?, short(2)?, 1.0),
            4 => (short(0)?, short(1)?, short(2)?, short(3)?),
            6 => (long(0)?, long(2)?, long(4)?, 1.0),
            8 => (long(0)?, long(2)?, long(4)?, long(6)?),
            _ => return None,
        };
        Some(Self { r, g, b, a })
    }

    /// GTK's `shade(c, f)`: lightness and saturation (HSL) times `f`, each clamped.
    pub fn shade(self, factor: f64) -> Self {
        let (h, s, l) = self.hsl();
        let (r, g, b) = hsl_to_rgb(h, unit(s * factor), unit(l * factor));
        Self { r, g, b, a: self.a }
    }

    /// GTK's `alpha(c, f)`: the opacity times `f`, clamped.
    pub fn alpha(self, factor: f64) -> Self {
        Self { a: unit(self.a * factor), ..self }
    }

    /// GTK's `mix(a, b, f)`: each channel, alpha included, `f` of the way from `self` to `other`
    /// (`f` clamped into `0..=1`).
    pub fn mix(self, other: Self, factor: f64) -> Self {
        let f = unit(factor);
        let at = |x: f64, y: f64| unit(x + (y - x) * f);
        Self { r: at(self.r, other.r), g: at(self.g, other.g), b: at(self.b, other.b), a: at(self.a, other.a) }
    }

    /// This colour painted at `share` (0..=1) over the opaque colour `base`, as CSS's
    /// `color-mix(in srgb, self share, base)` gives it for an opaque `self`.
    pub fn over(self, base: Self, share: f64) -> Self {
        base.mix(self, share)
    }

    /// WCAG relative luminance (0 black … 1 white), ignoring alpha.
    pub fn luminance(self) -> f64 {
        0.2126 * linear(self.r) + 0.7152 * linear(self.g) + 0.0722 * linear(self.b)
    }

    /// The accent as text on the view (libadwaita's standalone accent): OKLCH lightness at most
    /// 0.5 on a light theme and at least 0.85 on a dark one, hue and chroma kept.
    pub fn standalone(self, dark: bool) -> Self {
        let (l, a, b) = oklab(self);
        let l = if dark { l.max(0.85) } else { l.min(0.5) };
        let (r, g, b) = from_oklab(l, a, b);
        Self::new(r, g, b, self.a)
    }

    /// `(hue 0..1, saturation, lightness)`, as GTK's HSLA computes them.
    fn hsl(self) -> (f64, f64, f64) {
        let max = self.r.max(self.g).max(self.b);
        let min = self.r.min(self.g).min(self.b);
        let l = (max + min) / 2.0;
        let d = max - min;
        if d <= f64::EPSILON {
            return (0.0, 0.0, l);
        }
        let s = if l <= 0.5 { d / (max + min) } else { d / (2.0 - max - min) };
        let h = if max == self.r {
            (self.g - self.b) / d + if self.g < self.b { 6.0 } else { 0.0 }
        } else if max == self.g {
            (self.b - self.r) / d + 2.0
        } else {
            (self.r - self.g) / d + 4.0
        };
        (h / 6.0, s, l)
    }
}

/// CSS text for the colour, built only from its numbers: `#rrggbb` when opaque, else
/// `rgba(r, g, b, a)` with the alpha to three places.
impl fmt::Display for Rgba {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let [r, g, b, a] = [self.r, self.g, self.b, self.a].map(byte);
        if a == 255 {
            write!(f, "#{r:02x}{g:02x}{b:02x}")
        } else {
            let alpha = format!("{:.3}", self.a);
            let alpha = alpha.trim_end_matches('0').trim_end_matches('.');
            write!(f, "rgba({r}, {g}, {b}, {alpha})")
        }
    }
}

/// `x` clamped into `0..=1`; NaN becomes 0.
fn unit(x: f64) -> f64 {
    if x.is_nan() { 0.0 } else { x.clamp(0.0, 1.0) }
}

/// A channel as a byte, rounded.
fn byte(x: f64) -> u8 {
    // In range after the clamp, so the cast neither wraps nor saturates.
    (unit(x) * 255.0).round() as u8
}

fn hsl_to_rgb(h: f64, s: f64, l: f64) -> (f64, f64, f64) {
    if s <= 0.0 {
        return (l, l, l);
    }
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    (hue(p, q, h + 1.0 / 3.0), hue(p, q, h), hue(p, q, h - 1.0 / 3.0))
}

fn hue(p: f64, q: f64, t: f64) -> f64 {
    let t = t.rem_euclid(1.0);
    if t < 1.0 / 6.0 {
        p + (q - p) * 6.0 * t
    } else if t < 0.5 {
        q
    } else if t < 2.0 / 3.0 {
        p + (q - p) * (2.0 / 3.0 - t) * 6.0
    } else {
        p
    }
}

/// sRGB channel → linear light.
fn linear(c: f64) -> f64 {
    if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
}

/// Linear light → sRGB channel.
fn gamma(c: f64) -> f64 {
    if c <= 0.003_130_8 { c * 12.92 } else { 1.055 * c.powf(1.0 / 2.4) - 0.055 }
}

/// sRGB → OKLab `(L, a, b)` (Björn Ottosson's matrices).
fn oklab(c: Rgba) -> (f64, f64, f64) {
    let (r, g, b) = (linear(c.r), linear(c.g), linear(c.b));
    let l = (0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b).cbrt();
    let m = (0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b).cbrt();
    let s = (0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b).cbrt();
    (
        0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s,
        1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s,
        0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s,
    )
}

/// OKLab → sRGB channels (unclamped).
fn from_oklab(l: f64, a: f64, b: f64) -> (f64, f64, f64) {
    let l_ = (l + 0.396_337_777_4 * a + 0.215_803_757_3 * b).powi(3);
    let m_ = (l - 0.105_561_345_8 * a - 0.063_854_172_8 * b).powi(3);
    let s_ = (l - 0.089_484_177_5 * a - 1.291_485_548 * b).powi(3);
    (
        gamma(4.076_741_662_1 * l_ - 3.307_711_591_3 * m_ + 0.230_969_929_2 * s_),
        gamma(-1.268_438_004_6 * l_ + 2.609_757_401_1 * m_ - 0.341_319_396_5 * s_),
        gamma(-0.004_196_086_3 * l_ - 0.703_418_614_7 * m_ + 1.707_614_701 * s_),
    )
}

#[cfg(test)]
#[path = "color_tests.rs"]
mod tests;
