//! Reading and editing JSONC settings files. Reads accept JSON with comments and trailing commas
//! (VS Code's JSONC), nothing looser. Edits change one key in place and keep every other byte:
//! comments, formatting, and keys Lecter doesn't know.

use std::io::{ErrorKind, Read};
use std::path::Path;

use jsonc_parser::ParseOptions;
use jsonc_parser::cst::{CstInputValue, CstObject, CstRootNode};
use serde_json::Value;

/// The largest settings file read. A bigger one is reported and skipped, not parsed.
pub(crate) const MAX_FILE_BYTES: u64 = 1 << 20;

/// JSON plus comments and trailing commas; JSON5 extras (single quotes, hex, `Infinity`, bare
/// keys) are errors, so a file reads the same in any JSONC editor.
fn options() -> ParseOptions {
    ParseOptions {
        allow_comments: true,
        allow_loose_object_property_names: false,
        allow_trailing_commas: true,
        allow_missing_commas: false,
        allow_single_quoted_strings: false,
        allow_hexadecimal_numbers: false,
        allow_unary_plus_numbers: false,
        allow_bare_decimal_point_numbers: false,
        allow_non_finite_numbers: false,
        allow_extended_string_escapes: false,
    }
}

/// Why a settings file couldn't be used. Messages never quote the file's text.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum FileError {
    /// The OS refused the read.
    #[error("could not be read ({0:?})")]
    Io(ErrorKind),
    /// Over [`MAX_FILE_BYTES`].
    #[error("is larger than {MAX_FILE_BYTES} bytes")]
    TooLarge,
    /// Not UTF-8.
    #[error("is not UTF-8 text")]
    NotUtf8,
    /// Not JSONC.
    #[error("is not valid JSONC (line {line}, column {column})")]
    Syntax {
        /// 1-based line.
        line: usize,
        /// 1-based column.
        column: usize,
    },
    /// The file (or its folder) is a link that leads out of the course (SEC-35).
    #[error("points outside the course folder")]
    OutsideCourse,
    /// Valid JSONC whose top level, or `settings` object, isn't an object.
    #[error("must hold an object at {0}")]
    NotAnObject(&'static str),
}

/// Checks that `path`, once links are resolved, stays under `root` (a course file can't be a
/// link to a file elsewhere, SEC-35). A missing file passes if its folder stays under `root`.
#[allow(clippy::disallowed_methods, reason = "settings files are read on a blocking thread")]
pub(crate) fn check_within(path: &Path, root: Option<&Path>) -> Result<(), FileError> {
    let Some(root) = root else { return Ok(()) };
    let root = std::fs::canonicalize(root).map_err(|e| FileError::Io(e.kind()))?;
    let resolved = match std::fs::canonicalize(path) {
        Ok(p) => p,
        // A link that leads nowhere (or loops) is never followed.
        Err(_) if std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) => {
            return Err(FileError::OutsideCourse);
        }
        // No file: its folder must still be inside (a new file is written there). Anything else
        // wrong with the path, the read reports.
        Err(_) => match path.parent().map(std::fs::canonicalize) {
            Some(Ok(dir)) => dir,
            _ => return Ok(()),
        },
    };
    if resolved.starts_with(&root) { Ok(()) } else { Err(FileError::OutsideCourse) }
}

/// The file's text, or `None` when it doesn't exist.
#[allow(clippy::disallowed_methods, reason = "settings files are read on a blocking thread")]
pub(crate) fn read_text(path: &Path) -> Result<Option<String>, FileError> {
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(FileError::Io(e.kind())),
    };
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes).map_err(|e| FileError::Io(e.kind()))?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(FileError::TooLarge);
    }
    String::from_utf8(bytes).map(Some).map_err(|_| FileError::NotUtf8)
}

/// Parses JSONC text. Empty text is an empty object (a new, blank file).
pub(crate) fn parse(text: &str) -> Result<Value, FileError> {
    if text.trim().is_empty() {
        return Ok(Value::Object(serde_json::Map::new()));
    }
    jsonc_parser::parse_to_serde_value::<Value>(text, &options()).map_err(|e| {
        let (line, column) = line_column(text, e.range().start);
        FileError::Syntax { line, column }
    })
}

/// 1-based line and column of byte offset `at`.
fn line_column(text: &str, at: usize) -> (usize, usize) {
    let before = text.get(..at).unwrap_or(text);
    let line = before.matches('\n').count() + 1;
    let column = before.rsplit('\n').next().map_or(0, |l| l.chars().count()) + 1;
    (line, column)
}

/// The settings object in a parsed file: the top level, or the object under `section`.
/// A missing section is empty.
pub(crate) fn settings_object(root: Value, section: Option<&'static str>) -> Result<Value, FileError> {
    if !root.is_object() {
        return Err(FileError::NotAnObject("the top level"));
    }
    let Some(name) = section else { return Ok(root) };
    match root {
        Value::Object(mut map) => match map.remove(name) {
            None | Some(Value::Null) => Ok(Value::Object(serde_json::Map::new())),
            Some(v @ Value::Object(_)) => Ok(v),
            Some(_) => Err(FileError::NotAnObject(name)),
        },
        _ => Err(FileError::NotAnObject("the top level")),
    }
}

/// Returns `text` with the dotted `key` (under `section`, if any) set to `value`, everything else
/// unchanged. Objects on the way are created; a non-object on the way is replaced by one.
pub(crate) fn set_key(text: &str, section: Option<&str>, key: &str, value: &Value) -> Result<String, FileError> {
    let source = if text.trim().is_empty() { "{}\n" } else { text };
    let root = CstRootNode::parse(source, &options()).map_err(|e| {
        let (line, column) = line_column(source, e.range().start);
        FileError::Syntax { line, column }
    })?;
    if root.value().is_some_and(|v| v.as_object().is_none()) {
        return Err(FileError::NotAnObject("the top level"));
    }
    let mut object: CstObject = root.object_value_or_set();
    if let Some(name) = section {
        object = object.object_value_or_set(name);
    }
    let mut parts = key.split('.').peekable();
    while let Some(part) = parts.next() {
        if parts.peek().is_none() {
            match object.get(part) {
                Some(prop) => prop.set_value(input(value)),
                None => {
                    object.append(part, input(value));
                }
            }
        } else {
            object = object.object_value_or_set(part);
        }
    }
    Ok(root.to_string())
}

/// A JSON value as CST input.
fn input(value: &Value) -> CstInputValue {
    match value {
        Value::Null => CstInputValue::Null,
        Value::Bool(b) => CstInputValue::Bool(*b),
        Value::Number(n) => CstInputValue::Number(n.to_string()),
        Value::String(s) => CstInputValue::String(s.clone()),
        Value::Array(items) => CstInputValue::Array(items.iter().map(input).collect()),
        Value::Object(map) => CstInputValue::Object(map.iter().map(|(k, v)| (k.clone(), input(v))).collect()),
    }
}
