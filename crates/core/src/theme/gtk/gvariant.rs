//! The GVariant text format that `gdbus` and `gsettings` print (`g_variant_print`), read just
//! far enough for the desktop settings: strings, numbers, booleans, tuples, arrays, dictionaries
//! and variants. The input comes from another process, so it is size- and depth-limited.

/// The longest text parsed, in bytes.
pub const MAX_TEXT_BYTES: usize = 256 * 1024;
/// How deep containers may nest.
const MAX_DEPTH: usize = 32;

/// A parsed value.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    /// `'text'` or `"text"`.
    Str(String),
    /// Any number (`uint32 1`, `0.5`, `-3`).
    Num(f64),
    /// `true` or `false`.
    Bool(bool),
    /// `(a, b)`, or an array `[a, b]`.
    List(Vec<Value>),
    /// `{key: value, …}`.
    Dict(Vec<(Value, Value)>),
}

impl Value {
    /// The string, if this is one.
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Self::Str(s) => Some(s),
            _ => None,
        }
    }

    /// The value under string key `key`, if this is a dictionary.
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Self::Dict(entries) => entries.iter().find(|(k, _)| k.as_str() == Some(key)).map(|(_, v)| v),
            _ => None,
        }
    }
}

/// Parses one value; `None` for text that isn't one (or is too long or deep), or that has
/// anything but whitespace after it.
pub fn parse(text: &str) -> Option<Value> {
    if text.len() > MAX_TEXT_BYTES {
        return None;
    }
    let mut p = Parser { s: text.as_bytes(), pos: 0 };
    let value = p.value(0)?;
    p.space();
    (p.pos == p.s.len()).then_some(value)
}

struct Parser<'a> {
    s: &'a [u8],
    pos: usize,
}

impl Parser<'_> {
    fn peek(&self) -> Option<u8> {
        self.s.get(self.pos).copied()
    }

    fn space(&mut self) {
        while self.peek().is_some_and(|b| b.is_ascii_whitespace()) {
            self.pos += 1;
        }
    }

    fn eat(&mut self, b: u8) -> bool {
        self.space();
        if self.peek() == Some(b) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn word(&mut self) -> &[u8] {
        let start = self.pos;
        while self.peek().is_some_and(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-' | b'+')) {
            self.pos += 1;
        }
        &self.s[start..self.pos]
    }

    fn value(&mut self, depth: usize) -> Option<Value> {
        if depth > MAX_DEPTH {
            return None;
        }
        self.space();
        match self.peek()? {
            b'<' => {
                self.pos += 1;
                let v = self.value(depth + 1)?;
                self.eat(b'>').then_some(v)
            }
            b'(' => self.list(b')', depth),
            b'[' => self.list(b']', depth),
            b'{' => self.dict(depth),
            b'\'' | b'"' => self.string().map(Value::Str),
            b'@' => {
                // A type annotation (`@a{sv} {}`): skip the type, read the value.
                self.pos += 1;
                while self.peek().is_some_and(|b| !b.is_ascii_whitespace()) {
                    self.pos += 1;
                }
                self.value(depth + 1)
            }
            _ => {
                let word = std::str::from_utf8(self.word()).ok()?.to_owned();
                match word.as_str() {
                    "true" => Some(Value::Bool(true)),
                    "false" => Some(Value::Bool(false)),
                    "byte" | "int16" | "uint16" | "int32" | "uint32" | "int64" | "uint64" | "double" | "handle" => {
                        self.space();
                        let n = std::str::from_utf8(self.word()).ok()?.to_owned();
                        number(&n).map(Value::Num)
                    }
                    other => number(other).map(Value::Num),
                }
            }
        }
    }

    fn list(&mut self, close: u8, depth: usize) -> Option<Value> {
        self.pos += 1;
        let mut items = Vec::new();
        loop {
            if self.eat(close) {
                return Some(Value::List(items));
            }
            items.push(self.value(depth + 1)?);
            if !self.eat(b',') {
                return self.eat(close).then_some(Value::List(items));
            }
        }
    }

    fn dict(&mut self, depth: usize) -> Option<Value> {
        self.pos += 1;
        let mut entries = Vec::new();
        loop {
            if self.eat(b'}') {
                return Some(Value::Dict(entries));
            }
            let key = self.value(depth + 1)?;
            if !self.eat(b':') {
                return None;
            }
            entries.push((key, self.value(depth + 1)?));
            if !self.eat(b',') {
                return self.eat(b'}').then_some(Value::Dict(entries));
            }
        }
    }

    fn string(&mut self) -> Option<String> {
        let quote = self.peek()?;
        self.pos += 1;
        let mut out = Vec::new();
        loop {
            let b = self.peek()?;
            self.pos += 1;
            match b {
                b'\\' => {
                    let escaped = self.peek()?;
                    self.pos += 1;
                    out.push(match escaped {
                        b'n' => b'\n',
                        b't' => b'\t',
                        other => other,
                    });
                }
                b if b == quote => return String::from_utf8(out).ok(),
                b => out.push(b),
            }
        }
    }
}

/// A decimal number or `0x` hex integer.
fn number(text: &str) -> Option<f64> {
    let n = match text.strip_prefix("0x") {
        Some(hex) => u64::from_str_radix(hex, 16).ok().map(|n| n as f64),
        None => text.parse::<f64>().ok(),
    }?;
    n.is_finite().then_some(n)
}

#[cfg(test)]
#[path = "gvariant_tests.rs"]
mod tests;
