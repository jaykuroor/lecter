//! SEC-25: a course (its `course.jsonc` or a course role file) can't loosen global settings.
//!
//! Two kinds of rule. **Global-only keys** are ignored in a course whatever their value:
//! `privacy.*`, `log.*`, `limits.*`, `feedback.endpoint`, and every key that names where traffic
//! goes (a provider host or base URL, a search service URL). **Tighten-only keys** are kept only
//! when they are no looser than the global value: budgets, web search, `web_fetch` and the
//! search domain lists.

use serde_json::Value;

/// Top-level groups that only the global config may set.
const GLOBAL_GROUPS: [&str; 3] = ["privacy", "log", "limits"];

/// Words in a key segment that make it name a network destination.
const DESTINATION_WORDS: [&str; 9] =
    ["url", "urls", "baseurl", "uri", "host", "hosts", "hostname", "endpoint", "endpoints"];

/// Whether a course may never set `key` (dotted, as written in the file). Case-insensitive, so
/// `"Privacy"` can't slip past as a different key.
pub(crate) fn is_global_only(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    let first = lower.split('.').next().unwrap_or_default();
    GLOBAL_GROUPS.contains(&first)
        || lower == "feedback.endpoint"
        || key.split('.').any(|segment| words(segment).iter().any(|w| DESTINATION_WORDS.contains(&w.as_str())))
}

/// The lowercase words of a key segment: `baseUrl` → base, url; `serviceURL` → service, url;
/// `base_url` → base, url.
fn words(segment: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut current = String::new();
    let chars: Vec<char> = segment.chars().collect();
    for (i, &c) in chars.iter().enumerate() {
        if !c.is_alphanumeric() {
            if !current.is_empty() {
                out.push(std::mem::take(&mut current));
            }
            continue;
        }
        let prev = i.checked_sub(1).and_then(|p| chars.get(p)).copied();
        let next = chars.get(i + 1).copied();
        let boundary = c.is_uppercase()
            && prev.is_some_and(|p| {
                p.is_lowercase() || p.is_numeric() || (p.is_uppercase() && next.is_some_and(char::is_lowercase))
            });
        if boundary && !current.is_empty() {
            out.push(std::mem::take(&mut current));
        }
        current.extend(c.to_lowercase());
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

/// Whether the course value `course` for the known `key` loosens the global value `global`.
/// Keys without a tighten-only rule never do.
pub(crate) fn loosens(key: &str, course: &Value, global: &Value) -> bool {
    if key.starts_with("ai.budget.") {
        return match (course.as_f64(), global.as_f64()) {
            // No global cap: any course cap is tighter.
            (_, None) => false,
            // Removing the global cap, or raising it.
            (None, Some(_)) => true,
            (Some(c), Some(g)) => c > g,
        };
    }
    match key {
        "ai.webSearch" => global.as_str() == Some("off") && course.as_str() != Some("off"),
        "ai.search.allowFetch" => global.as_bool() != Some(true) && course.as_bool() != Some(false),
        // Every globally blocked domain stays blocked.
        "ai.search.blockDomains" => !strings(global).iter().all(|d| strings(course).contains(d)),
        // A global allow list can only shrink, never empty (empty means any domain).
        "ai.search.allowDomains" => {
            let g = strings(global);
            let c = strings(course);
            !g.is_empty() && (c.is_empty() || !c.iter().all(|d| g.contains(d)))
        }
        _ => false,
    }
}

/// The strings in a JSON array, lowercased (domains compare without case).
fn strings(value: &Value) -> Vec<String> {
    value.as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_ascii_lowercase).collect()
}
