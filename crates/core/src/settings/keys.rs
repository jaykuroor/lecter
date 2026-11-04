//! Keys as dotted paths (`ui.performance`): which exist, their defaults, and checking one value.
//! All of it derives from the [`Settings`] types, so the keys, the schema and validation can't
//! drift apart.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde_json::{Map, Value};

use super::schema::{Settings, schema_value};

/// Every known key with its built-in default, built once from `Settings::default()`.
pub(crate) fn defaults() -> &'static BTreeMap<String, Value> {
    static DEFAULTS: OnceLock<BTreeMap<String, Value>> = OnceLock::new();
    DEFAULTS.get_or_init(|| {
        let mut out = BTreeMap::new();
        if let Ok(value) = serde_json::to_value(Settings::default()) {
            flatten_known(&value, "", &mut out);
        }
        out
    })
}

/// Leaves of the defaults tree: every non-object value is one key.
fn flatten_known(value: &Value, prefix: &str, out: &mut BTreeMap<String, Value>) {
    match value {
        Value::Object(map) => {
            for (k, v) in map {
                flatten_known(v, &join(prefix, k), out);
            }
        }
        leaf => {
            out.insert(prefix.to_owned(), leaf.clone());
        }
    }
}

/// `prefix.key`, or `key` at the top.
pub(crate) fn join(prefix: &str, key: &str) -> String {
    if prefix.is_empty() { key.to_owned() } else { format!("{prefix}.{key}") }
}

/// Whether `key` names one setting.
pub(crate) fn is_known(key: &str) -> bool {
    defaults().contains_key(key)
}

/// Whether some known key lies under `prefix` (so an object there is a group, not unknown).
pub(crate) fn is_group(prefix: &str) -> bool {
    let start = format!("{prefix}.");
    defaults().range(start.clone()..).next().is_some_and(|(k, _)| k.starts_with(&start))
}

/// Builds `{"a": {"b": value}}` for `a.b`.
pub(crate) fn nest(key: &str, value: Value) -> Value {
    key.rsplit('.').fold(value, |inner, part| {
        let mut map = Map::new();
        map.insert(part.to_owned(), inner);
        Value::Object(map)
    })
}

/// Checks `value` for the known `key` against its type. The error is one line for the user; for a
/// key with a fixed set of values it lists them.
pub(crate) fn validate(key: &str, value: &Value) -> Result<(), String> {
    match serde_json::from_value::<Settings>(nest(key, value.clone())) {
        Ok(_) => Ok(()),
        Err(e) => Err(match allowed_values(key) {
            Some(allowed) => format!("{key} must be one of {}", allowed.join(", ")),
            None => format!("{key}: {e}"),
        }),
    }
}

/// The fixed values a key takes (an enum), from the generated schema; `None` for free values.
pub(crate) fn allowed_values(key: &str) -> Option<Vec<String>> {
    let root = schema_value();
    let mut node = &root;
    for part in key.split('.') {
        node = deref(&root, node).get("properties")?.get(part)?;
    }
    let mut out = Vec::new();
    collect_consts(&root, node, &mut out);
    (!out.is_empty()).then_some(out)
}

/// Follows a `$ref` into `$defs`.
fn deref<'a>(root: &'a Value, node: &'a Value) -> &'a Value {
    node.get("$ref")
        .and_then(Value::as_str)
        .and_then(|r| r.strip_prefix("#/$defs/"))
        .and_then(|name| root.get("$defs")?.get(name))
        .unwrap_or(node)
}

/// String constants under `node`: `enum` lists, `const`s, and `oneOf`/`anyOf` branches.
fn collect_consts(root: &Value, node: &Value, out: &mut Vec<String>) {
    let node = deref(root, node);
    if let Some(list) = node.get("enum").and_then(Value::as_array) {
        out.extend(list.iter().filter_map(Value::as_str).map(str::to_owned));
    }
    if let Some(c) = node.get("const").and_then(Value::as_str) {
        out.push(c.to_owned());
    }
    for branch in ["oneOf", "anyOf"] {
        for sub in node.get(branch).and_then(Value::as_array).into_iter().flatten() {
            collect_consts(root, sub, out);
        }
    }
}
