//! The `@define-color` names of a theme's `gtk.css`, read defensively: the file is untrusted
//! input (13-security.md). The scan is one linear pass with caps on the file, the number of
//! names and each name and value; `@import` and every other rule are skipped, never followed;
//! references (`@name`) resolve through a memo with a depth limit and a step budget, so a cycle
//! or a deep chain ends as "not defined" instead of recursing without bound.

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

use super::color::Rgba;

/// The largest `gtk.css` read, in bytes. The largest of 55 real themes measured is 661 KB.
pub const MAX_CSS_BYTES: u64 = 2 * 1024 * 1024;
/// The most `@define-color` names kept; later ones are ignored.
pub const MAX_DEFINES: usize = 4096;
/// The longest name kept, in bytes.
pub const MAX_NAME_BYTES: usize = 128;
/// The longest value kept, in bytes.
pub const MAX_VALUE_BYTES: usize = 512;
/// How deep references and colour functions may nest.
pub const MAX_DEPTH: usize = 24;
/// How many colour expressions one [`Resolver`] evaluates at most.
pub const MAX_STEPS: usize = 50_000;

/// Why a theme's CSS could not be read.
#[derive(Debug, thiserror::Error)]
pub enum CssError {
    /// The file is larger than [`MAX_CSS_BYTES`].
    #[error("the theme's CSS is larger than {MAX_CSS_BYTES} bytes")]
    TooLarge,
    /// Reading failed.
    #[error("the theme's CSS could not be read: {0}")]
    Io(#[from] std::io::Error),
}

/// Reads a `gtk.css`, refusing one over [`MAX_CSS_BYTES`]; invalid UTF-8 is replaced. Blocking:
/// async callers run it in `spawn_blocking`.
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
pub fn read_css(path: &Path) -> Result<String, CssError> {
    let file = std::fs::File::open(path)?;
    let mut bytes = Vec::new();
    file.take(MAX_CSS_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_CSS_BYTES {
        return Err(CssError::TooLarge);
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// A theme's `@define-color` definitions, unresolved: name → value text. A later definition of
/// a name replaces an earlier one, as in GTK.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Defines {
    values: HashMap<String, String>,
}

impl Defines {
    /// Scans `css` for `@define-color <name> <value>;` outside comments and strings.
    pub fn parse(css: &str) -> Self {
        let mut values = HashMap::new();
        let bytes = css.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            match bytes[i] {
                b'/' if bytes.get(i + 1) == Some(&b'*') => i = skip_comment(bytes, i + 2),
                b'"' | b'\'' => i = skip_string(bytes, i),
                b'@' => {
                    let start = i + 1;
                    let end = ident_end(bytes, start);
                    i = end;
                    if &css[start..end] == "define-color" {
                        let (next, define) = definition(css, end);
                        i = next;
                        if let Some((name, value)) = define
                            && (values.len() < MAX_DEFINES || values.contains_key(name))
                        {
                            values.insert(name.to_owned(), value.to_owned());
                        }
                    }
                }
                _ => i += 1,
            }
        }
        Self { values }
    }

    /// How many names are defined.
    pub fn len(&self) -> usize {
        self.values.len()
    }

    /// Whether no name is defined.
    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    /// A resolver for these definitions.
    pub fn resolver(&self) -> Resolver<'_> {
        Resolver { defines: self, memo: HashMap::new(), active: Vec::new(), steps: 0 }
    }
}

/// Resolves names to colours, each at most once.
#[derive(Debug)]
pub struct Resolver<'a> {
    defines: &'a Defines,
    memo: HashMap<&'a str, Option<Rgba>>,
    active: Vec<&'a str>,
    steps: usize,
}

impl<'a> Resolver<'a> {
    /// The colour `name` is defined as, or `None` when it isn't defined, its value isn't a colour
    /// this parser knows, or it refers to itself or too deep.
    pub fn get(&mut self, name: &str) -> Option<Rgba> {
        let (key, value) = self.defines.values.get_key_value(name)?;
        if let Some(known) = self.memo.get(key.as_str()) {
            return *known;
        }
        if self.active.contains(&key.as_str()) || self.active.len() >= MAX_DEPTH {
            return None;
        }
        self.active.push(key);
        let mut parser = Expr { text: value, pos: 0 };
        let colour = parser.colour(self, self.active.len()).filter(|_| parser.at_end());
        self.active.pop();
        self.memo.insert(key, colour);
        colour
    }
}

/// After `@define-color`: `(index after the statement, Some((name, value)) when well-formed)`.
fn definition(css: &str, from: usize) -> (usize, Option<(&str, &str)>) {
    let bytes = css.as_bytes();
    let name_start = skip_space(bytes, from);
    let name_end = ident_end(bytes, name_start);
    // A value ends at the first `;` (colour values never contain one, so an unclosed `(` can't
    // swallow the rest of the file); a brace means the statement was never closed.
    let mut i = name_end;
    while i < bytes.len() {
        match bytes[i] {
            b';' => break,
            b'{' | b'}' => return (i, None),
            _ => i += 1,
        }
    }
    let name = &css[name_start..name_end];
    let value = css[name_end..i.min(bytes.len())].trim();
    let ok = i < bytes.len()
        && !name.is_empty()
        && name.len() <= MAX_NAME_BYTES
        && !value.is_empty()
        && value.len() <= MAX_VALUE_BYTES;
    (i + 1, ok.then_some((name, value)))
}

fn skip_comment(bytes: &[u8], from: usize) -> usize {
    let mut i = from;
    while i + 1 < bytes.len() {
        if bytes[i] == b'*' && bytes[i + 1] == b'/' {
            return i + 2;
        }
        i += 1;
    }
    bytes.len()
}

fn skip_string(bytes: &[u8], from: usize) -> usize {
    let quote = bytes[from];
    let mut i = from + 1;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            b if b == quote => return i + 1,
            b'\n' => return i + 1,
            _ => i += 1,
        }
    }
    bytes.len()
}

fn skip_space(bytes: &[u8], from: usize) -> usize {
    let mut i = from;
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    i
}

fn is_ident(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

fn ident_end(bytes: &[u8], from: usize) -> usize {
    let mut i = from;
    while i < bytes.len() && is_ident(bytes[i]) {
        i += 1;
    }
    i
}

/// A recursive-descent reader of one colour expression, evaluated as it is read.
struct Expr<'t> {
    text: &'t str,
    pos: usize,
}

impl Expr<'_> {
    fn at_end(&mut self) -> bool {
        self.space();
        self.pos >= self.text.len()
    }

    fn space(&mut self) {
        self.pos = skip_space(self.text.as_bytes(), self.pos);
    }

    fn eat(&mut self, b: u8) -> bool {
        self.space();
        if self.text.as_bytes().get(self.pos) == Some(&b) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn ident(&mut self) -> &str {
        let start = self.pos;
        self.pos = ident_end(self.text.as_bytes(), start);
        &self.text[start..self.pos]
    }

    fn colour(&mut self, resolver: &mut Resolver<'_>, depth: usize) -> Option<Rgba> {
        resolver.steps += 1;
        if depth > MAX_DEPTH || resolver.steps > MAX_STEPS {
            return None;
        }
        if self.eat(b'@') {
            let name = self.ident().to_owned();
            return resolver.get(&name);
        }
        if self.eat(b'#') {
            let start = self.pos;
            while self.text.as_bytes().get(self.pos).is_some_and(u8::is_ascii_alphanumeric) {
                self.pos += 1;
            }
            return Rgba::from_hash(&self.text[start..self.pos]);
        }
        let name = self.ident().to_ascii_lowercase();
        if !self.eat(b'(') {
            return Rgba::named(&name);
        }
        let colour = match name.as_str() {
            "rgb" | "rgba" => self.rgb(),
            "shade" => {
                let c = self.colour(resolver, depth + 1)?;
                self.comma()?;
                Some(c.shade(self.number()?.0))
            }
            "alpha" => {
                let c = self.colour(resolver, depth + 1)?;
                self.comma()?;
                Some(c.alpha(self.number()?.0))
            }
            "mix" => {
                let a = self.colour(resolver, depth + 1)?;
                self.comma()?;
                let b = self.colour(resolver, depth + 1)?;
                self.comma()?;
                Some(a.mix(b, self.number()?.0))
            }
            "lighter" => Some(self.colour(resolver, depth + 1)?.shade(1.3)),
            "darker" => Some(self.colour(resolver, depth + 1)?.shade(0.7)),
            _ => None,
        }?;
        self.eat(b')').then_some(colour)
    }

    fn comma(&mut self) -> Option<()> {
        self.eat(b',').then_some(())
    }

    /// `r, g, b[, a]` or `r g b[ / a]`; channels 0–255 or percentages, alpha 0–1 or a percentage.
    fn rgb(&mut self) -> Option<Rgba> {
        let mut channels = [0.0; 3];
        for (i, channel) in channels.iter_mut().enumerate() {
            if i > 0 {
                self.eat(b',');
            }
            let (n, percent) = self.number()?;
            *channel = if percent { n / 100.0 } else { n / 255.0 };
        }
        let alpha = if self.eat(b',') || self.eat(b'/') {
            let (n, percent) = self.number()?;
            if percent { n / 100.0 } else { n }
        } else {
            1.0
        };
        let [r, g, b] = channels;
        Some(Rgba::new(r, g, b, alpha))
    }

    /// A plain decimal number, optionally followed by `%`: `(value, is_percent)`.
    fn number(&mut self) -> Option<(f64, bool)> {
        self.space();
        let bytes = self.text.as_bytes();
        let start = self.pos;
        if matches!(bytes.get(self.pos), Some(b'+' | b'-')) {
            self.pos += 1;
        }
        while bytes.get(self.pos).is_some_and(|b| b.is_ascii_digit() || *b == b'.') {
            self.pos += 1;
        }
        let n: f64 = self.text[start..self.pos].parse().ok()?;
        let percent = self.text.as_bytes().get(self.pos) == Some(&b'%');
        if percent {
            self.pos += 1;
        }
        n.is_finite().then_some((n, percent))
    }
}

#[cfg(test)]
#[path = "css_tests.rs"]
mod tests;
