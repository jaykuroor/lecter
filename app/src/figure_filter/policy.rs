//! What the figure frames' request filter lets through (08-figures.md#sandbox-pages, D-145).
//!
//! A request from a figure frame passes only to a figure origin (`lecter-fig:` and `lecter-lib:` in
//! the app; the harness's stand-ins in the F-028 spike) or as a `data:` URL (the frame CSP's
//! `img-src data:`). Where the webview can't tell which frame a request comes from (WebView2's
//! `WebResourceRequested`), the page's own origins pass as well, so the app keeps working; the
//! frame's CSP still covers those.

use std::fmt;

use tauri::Url;

/// Who made a request, as far as the webview can tell.
#[cfg_attr(
    not(any(test, target_os = "windows")),
    expect(dead_code, reason = "only WebView2 filters request by request; WebKit gets webkit_rules")
)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    /// A figure frame (or a frame inside one).
    Frame,
    /// Unknown: the page or any of its frames.
    Any,
}

/// An origin the filter can't use: not `scheme://host[:port]`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BadOrigin(pub String);

impl fmt::Display for BadOrigin {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "not an origin (scheme://host[:port]): {:?}", self.0)
    }
}

impl std::error::Error for BadOrigin {}

/// The origins a figure frame may load from, and the page's own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Policy {
    figure: Vec<String>,
    page: Vec<String>,
}

impl Policy {
    /// `figure`: the origins frames may load from; `page`: the page's own (WebView2 only).
    pub fn new<S: AsRef<str>>(figure: &[S], page: &[S]) -> Result<Self, BadOrigin> {
        let parse = |list: &[S]| list.iter().map(|o| origin(o.as_ref())).collect::<Result<Vec<_>, _>>();
        let figure = parse(figure)?;
        if figure.is_empty() {
            return Err(BadOrigin(String::new()));
        }
        Ok(Self { figure, page: parse(page)? })
    }

    /// Whether a request to `url` from `source` may go ahead.
    #[cfg_attr(
        not(any(test, target_os = "windows")),
        expect(dead_code, reason = "only WebView2 filters request by request; WebKit gets webkit_rules")
    )]
    pub fn allows(&self, url: &str, source: Source) -> bool {
        if url.get(..5).is_some_and(|s| s.eq_ignore_ascii_case("data:")) {
            return true;
        }
        let Some(to) = url_origin(url) else {
            return false;
        };
        self.figure.contains(&to) || (source == Source::Any && self.page.contains(&to))
    }

    /// The WebKit content rule list (WebKitGTK `WebKitUserContentFilter`, WKWebView
    /// `WKContentRuleList`): block every load in a child frame, then let the figure origins and
    /// `data:` through. The page itself (`top-frame`) is left alone.
    pub fn webkit_rules(&self) -> String {
        let child = || serde_json::json!(["child-frame"]);
        let mut rules = vec![serde_json::json!({
            "trigger": { "url-filter": ".*", "load-context": child() },
            "action": { "type": "block" },
        })];
        let allowed =
            std::iter::once("^data:".to_owned()).chain(self.figure.iter().map(|o| format!("^{}/", escape(o))));
        for filter in allowed {
            rules.push(serde_json::json!({
                "trigger": { "url-filter": filter, "load-context": child() },
                "action": { "type": "ignore-previous-rules" },
            }));
        }
        serde_json::Value::Array(rules).to_string()
    }
}

/// `scheme://host[:port]`, lower case, from an origin string; anything with a path, query,
/// fragment or credentials is refused.
fn origin(text: &str) -> Result<String, BadOrigin> {
    let bad = || BadOrigin(text.to_owned());
    let url = Url::parse(text).map_err(|_| bad())?;
    let bare = matches!(url.path(), "" | "/")
        && url.query().is_none()
        && url.fragment().is_none()
        && url.username().is_empty()
        && url.password().is_none();
    if !bare {
        return Err(bad());
    }
    url_origin(text).ok_or_else(bad)
}

/// The `scheme://host[:port]` a URL points at, or None (no host, unparsable).
fn url_origin(text: &str) -> Option<String> {
    let url = Url::parse(text).ok()?;
    let host = url.host_str().filter(|h| !h.is_empty())?.to_ascii_lowercase();
    let port = url.port().map(|p| format!(":{p}")).unwrap_or_default();
    Some(format!("{}://{host}{port}", url.scheme()))
}

/// Escapes the characters WebKit's `url-filter` reads as regex syntax.
fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 8);
    for c in text.chars() {
        if r"\.*+?^$()[]{}|".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
#[path = "policy_tests.rs"]
mod tests;
