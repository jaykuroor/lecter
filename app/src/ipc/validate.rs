//! The shared IPC argument validator (18-contracts.md#validation, SEC-32). `guard.rs` applies the
//! global limits to every call before a command runs (any string, any list, the whole payload);
//! commands call `string`, `list` and `id` for their stricter per-field limits (prompt text,
//! search query, block ids). A violation is `E_INVALID_ARGUMENT`, logged without its content.

use std::io;

use serde_json::Value;
use tauri::ipc::InvokeBody;

use super::error::{ErrorCode, IpcError};

const KB: usize = 1024;

/// The `limits.ipc.*` limits, in UTF-8 bytes and items. `Default` is the spec's table; the
/// settings core (`12-settings-theme-onboarding.md`) will supply configured values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IpcLimits {
    /// Any single string: 64 KB.
    pub string_bytes: usize,
    /// Prompt text: 16 KB.
    pub prompt_bytes: usize,
    /// A search query: 1 KB.
    pub query_bytes: usize,
    /// Any list: 10,000 items.
    pub list_items: usize,
    /// The whole payload of one call: 1 MB.
    pub payload_bytes: usize,
}

impl Default for IpcLimits {
    fn default() -> Self {
        Self {
            string_bytes: 64 * KB,
            prompt_bytes: 16 * KB,
            query_bytes: KB,
            list_items: 10_000,
            payload_bytes: KB * KB,
        }
    }
}

/// The id patterns of 18-contracts.md#validation.
#[cfg_attr(not(test), expect(dead_code, reason = "no v0 command takes an id yet; the lecture and gloss commands will"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdKind {
    /// `s\d+b\d+`, e.g. `s4b2`.
    Block,
    /// `g-[0-9a-f]{4,8}`.
    Gloss,
    /// `n-[0-9a-f]{4,8}`.
    Note,
}

/// Rejects a string longer than `max_bytes` (UTF-8 bytes).
pub fn string(command: &str, field: &str, value: &str, max_bytes: usize) -> Result<(), IpcError> {
    if value.len() > max_bytes {
        return Err(reject(command, field, "string", value.len(), max_bytes));
    }
    Ok(())
}

/// Rejects a list with more than `max_items` items.
pub fn list<T>(command: &str, field: &str, items: &[T], max_items: usize) -> Result<(), IpcError> {
    if items.len() > max_items {
        return Err(reject(command, field, "list", items.len(), max_items));
    }
    Ok(())
}

/// Rejects an id that doesn't match its pattern.
#[cfg_attr(not(test), expect(dead_code, reason = "no v0 command takes an id yet; the lecture and gloss commands will"))]
pub fn id(command: &str, field: &str, value: &str, kind: IdKind) -> Result<(), IpcError> {
    let ok = match kind {
        IdKind::Block => block_id(value),
        IdKind::Gloss => hex_id(value, "g-"),
        IdKind::Note => hex_id(value, "n-"),
    };
    if !ok {
        tracing::warn!(target: "ipc", command, field, kind = ?kind, len = value.len(), "argument rejected: bad id");
        return Err(invalid(format!("{field}: not a valid {kind:?} id").to_lowercase()));
    }
    Ok(())
}

/// The global limits on one call's arguments: the whole payload, then every string (object keys
/// included) and every list anywhere in it. Raw (binary) bodies are checked for size only.
pub fn payload(command: &str, body: &InvokeBody, limits: &IpcLimits) -> Result<(), IpcError> {
    match body {
        InvokeBody::Raw(bytes) if bytes.len() > limits.payload_bytes => {
            Err(reject(command, "payload", "payload", bytes.len(), limits.payload_bytes))
        }
        InvokeBody::Raw(_) => Ok(()),
        InvokeBody::Json(value) => json(command, value, limits),
    }
}

fn json(command: &str, value: &Value, limits: &IpcLimits) -> Result<(), IpcError> {
    let size = json_size(value, limits.payload_bytes);
    if size > limits.payload_bytes {
        return Err(reject(command, "payload", "payload", size, limits.payload_bytes));
    }
    // An explicit stack: no recursion, whatever the nesting (serde_json caps it at 128 anyway).
    let mut stack = vec![value];
    while let Some(v) = stack.pop() {
        match v {
            Value::String(s) => string(command, "string", s, limits.string_bytes)?,
            Value::Array(items) => {
                list(command, "list", items, limits.list_items)?;
                stack.extend(items);
            }
            Value::Object(map) => {
                for (k, item) in map {
                    string(command, "key", k, limits.string_bytes)?;
                    stack.push(item);
                }
            }
            Value::Null | Value::Bool(_) | Value::Number(_) => {}
        }
    }
    Ok(())
}

/// The compact JSON size of `value`, counting stops a byte past `limit`.
fn json_size(value: &Value, limit: usize) -> usize {
    struct Counter {
        n: usize,
        limit: usize,
    }
    impl io::Write for Counter {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.n += buf.len();
            if self.n > self.limit { Err(io::Error::other("over the limit")) } else { Ok(buf.len()) }
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    let mut counter = Counter { n: 0, limit };
    // An error here only means the counter stopped early; `n` is then past the limit.
    let _ = serde_json::to_writer(&mut counter, value);
    counter.n
}

#[cfg_attr(not(test), expect(dead_code, reason = "no v0 command takes an id yet; the lecture and gloss commands will"))]
fn block_id(v: &str) -> bool {
    let Some(rest) = v.strip_prefix('s') else { return false };
    let Some((slide, block)) = rest.split_once('b') else { return false };
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    digits(slide) && digits(block)
}

#[cfg_attr(not(test), expect(dead_code, reason = "no v0 command takes an id yet; the lecture and gloss commands will"))]
fn hex_id(v: &str, prefix: &str) -> bool {
    v.strip_prefix(prefix).is_some_and(|h| {
        (4..=8).contains(&h.len()) && h.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}

/// Logs the violation by command, field, size and limit (never the value) and builds the error.
fn reject(command: &str, field: &str, what: &'static str, size: usize, limit: usize) -> IpcError {
    tracing::warn!(target: "ipc", command, field, what, size, limit, "argument rejected: over the limit");
    let unit = if what == "list" { "items" } else { "bytes" };
    invalid(format!("{field}: {size} {unit}, limit {limit}"))
}

fn invalid(detail: String) -> IpcError {
    IpcError::new(ErrorCode::InvalidArgument, "Lecter could not accept that request.").with_detail(detail)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const L: IpcLimits = IpcLimits {
        string_bytes: 64 * KB,
        prompt_bytes: 16 * KB,
        query_bytes: KB,
        list_items: 10_000,
        payload_bytes: KB * KB,
    };

    fn code<T>(r: Result<T, IpcError>) -> Option<ErrorCode> {
        r.err().map(|e| e.code)
    }

    fn text(n: usize) -> String {
        "a".repeat(n)
    }

    #[test]
    fn defaults_are_the_contract_table() {
        assert_eq!(IpcLimits::default(), L);
        assert_eq!(L.string_bytes, 65_536);
        assert_eq!(L.prompt_bytes, 16_384);
        assert_eq!(L.query_bytes, 1_024);
        assert_eq!(L.list_items, 10_000);
        assert_eq!(L.payload_bytes, 1_048_576);
    }

    #[test]
    fn any_string_over_64_kb_is_rejected() {
        assert_eq!(code(string("c", "f", &text(L.string_bytes), L.string_bytes)), None);
        assert_eq!(code(string("c", "f", &text(L.string_bytes + 1), L.string_bytes)), Some(ErrorCode::InvalidArgument));
    }

    #[test]
    fn prompt_text_over_16_kb_is_rejected() {
        assert_eq!(code(string("c", "prompt", &text(L.prompt_bytes), L.prompt_bytes)), None);
        assert_eq!(
            code(string("c", "prompt", &text(L.prompt_bytes + 1), L.prompt_bytes)),
            Some(ErrorCode::InvalidArgument)
        );
    }

    #[test]
    fn a_search_query_over_1_kb_is_rejected() {
        assert_eq!(code(string("c", "query", &text(L.query_bytes), L.query_bytes)), None);
        assert_eq!(
            code(string("c", "query", &text(L.query_bytes + 1), L.query_bytes)),
            Some(ErrorCode::InvalidArgument)
        );
    }

    #[test]
    fn string_limits_count_utf8_bytes_not_characters() {
        let e_acute = "é".repeat(L.query_bytes / 2 + 1); // 2 bytes each: 1 byte over
        assert_eq!(code(string("c", "query", &e_acute, L.query_bytes)), Some(ErrorCode::InvalidArgument));
    }

    #[test]
    fn a_list_over_10_000_items_is_rejected() {
        assert_eq!(code(list("c", "f", &vec![0u8; L.list_items], L.list_items)), None);
        assert_eq!(code(list("c", "f", &vec![0u8; L.list_items + 1], L.list_items)), Some(ErrorCode::InvalidArgument));
    }

    #[test]
    fn a_payload_over_1_mb_is_rejected() {
        // Many strings, each under 64 KB, adding up to more than 1 MB of JSON.
        let chunk = text(60 * KB);
        let n = L.payload_bytes / chunk.len() + 1;
        let big = json!({ "parts": vec![chunk.clone(); n] });
        assert_eq!(code(payload("c", &InvokeBody::Json(big), &L)), Some(ErrorCode::InvalidArgument));
        let ok = json!({ "parts": vec![chunk; n - 2] });
        assert_eq!(code(payload("c", &InvokeBody::Json(ok), &L)), None);
    }

    #[test]
    fn a_raw_payload_over_1_mb_is_rejected() {
        assert_eq!(code(payload("c", &InvokeBody::Raw(vec![0; L.payload_bytes]), &L)), None);
        let over = InvokeBody::Raw(vec![0; L.payload_bytes + 1]);
        assert_eq!(code(payload("c", &over, &L)), Some(ErrorCode::InvalidArgument));
    }

    #[test]
    fn the_payload_check_finds_a_long_string_or_list_at_any_depth() {
        let deep_string = json!({ "a": [{ "b": { "c": text(L.string_bytes + 1) } }] });
        assert_eq!(code(payload("c", &InvokeBody::Json(deep_string), &L)), Some(ErrorCode::InvalidArgument));
        let deep_list = json!({ "a": { "b": vec![1; L.list_items + 1] } });
        assert_eq!(code(payload("c", &InvokeBody::Json(deep_list), &L)), Some(ErrorCode::InvalidArgument));
        let long_key = json!({ text(L.string_bytes + 1): 1 });
        assert_eq!(code(payload("c", &InvokeBody::Json(long_key), &L)), Some(ErrorCode::InvalidArgument));
        let fine = json!({ "a": [{ "b": text(L.string_bytes) }], "n": 1, "t": true, "z": null });
        assert_eq!(code(payload("c", &InvokeBody::Json(fine), &L)), None);
    }

    #[test]
    fn ids_must_match_their_pattern() {
        for ok in ["s4b2", "s0b0", "s120b31"] {
            assert_eq!(code(id("c", "block", ok, IdKind::Block)), None, "{ok}");
        }
        for bad in ["s4", "b2", "s4b", "sb2", "s4b2x", "S4B2", "s-4b2", "s4b2 ", ""] {
            assert_eq!(code(id("c", "block", bad, IdKind::Block)), Some(ErrorCode::InvalidArgument), "{bad}");
        }
        for ok in ["g-7f3a", "g-0123abcd"] {
            assert_eq!(code(id("c", "gloss", ok, IdKind::Gloss)), None, "{ok}");
        }
        for bad in ["g-7f3", "g-0123abcde", "g-7F3A", "g-7g3a", "n-7f3a", "g7f3a"] {
            assert_eq!(code(id("c", "gloss", bad, IdKind::Gloss)), Some(ErrorCode::InvalidArgument), "{bad}");
        }
        assert_eq!(code(id("c", "note", "n-91c0", IdKind::Note)), None);
        assert_eq!(code(id("c", "note", "g-91c0", IdKind::Note)), Some(ErrorCode::InvalidArgument));
    }

    /// A violation's error names the field and the limit, never the rejected value.
    #[test]
    fn a_violation_never_carries_the_value() {
        let secret = format!("sk-{}", text(L.query_bytes));
        let e = string("search_find", "query", &secret, L.query_bytes).err().unwrap_or_else(|| panic!("accepted"));
        let all = format!("{} {:?}", e.message, e.detail);
        assert!(!all.contains("sk-"), "{all}");
        assert!(e.detail.as_deref().is_some_and(|d| d.contains("query") && d.contains("1024")), "{:?}", e.detail);
        let e = id("c", "block", "secret-id", IdKind::Block).err().unwrap_or_else(|| panic!("accepted"));
        assert!(!format!("{} {:?}", e.message, e.detail).contains("secret"));
    }
}
