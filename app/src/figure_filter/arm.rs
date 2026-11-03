//! Arming the filter from a test (F-028; test-hooks builds only). The real-app e2e flow
//! (tests/e2e/flows/figure-frame.ts) can't reach the core's IPC from its harness page and only
//! learns the harness's ports once the app runs, so it navigates the main webview to
//! `http://127.0.0.1:<port>/__lecter-test/figure-filter?figure=<origin>&page=<origin>&next=<url>`.
//! The navigation is cancelled, the filter armed with those origins, and the webview sent on to
//! `next` with the outcome in its query (`ff-filter=armed&ff-filter-kind=…` or
//! `ff-filter=failed&ff-filter-error=…`), which the harness grades.

use tauri::Url;

use super::policy::Policy;

/// The path that asks for the filter.
pub const PATH: &str = "/__lecter-test/figure-filter";

/// A request to arm the filter.
#[derive(Debug, PartialEq, Eq)]
pub struct Arm {
    pub policy: Policy,
    /// Where the webview goes once the filter is armed (or failed to arm).
    pub next: Url,
}

/// None for any other navigation; otherwise the request, or why it is refused. Only plain-HTTP
/// loopback URLs count, and `next` must stay on the same origin.
pub fn parse(url: &Url) -> Option<Result<Arm, String>> {
    let loopback = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    if url.scheme() != "http" || !loopback || url.path() != PATH {
        return None;
    }
    Some(arm(url))
}

fn arm(url: &Url) -> Result<Arm, String> {
    let pick = |key: &str| url.query_pairs().filter(|(k, _)| k == key).map(|(_, v)| v.into_owned()).collect::<Vec<_>>();
    let policy = Policy::new(&pick("figure"), &pick("page")).map_err(|e| e.to_string())?;
    let next = match pick("next").as_slice() {
        [one] => Url::parse(one).map_err(|e| format!("next: {e}"))?,
        _ => return Err("exactly one next= is needed".to_owned()),
    };
    if next.origin() != url.origin() {
        return Err(format!("next must stay on {}", url.origin().ascii_serialization()));
    }
    Ok(Arm { policy, next })
}

/// `next` with the outcome appended to its query.
pub fn report(next: &Url, outcome: &Result<&str, String>) -> Url {
    let mut url = next.clone();
    {
        let mut query = url.query_pairs_mut();
        match outcome {
            Ok(kind) => query.append_pair("ff-filter", "armed").append_pair("ff-filter-kind", kind),
            Err(e) => query.append_pair("ff-filter", "failed").append_pair("ff-filter-error", e),
        };
    }
    url
}

#[cfg(test)]
mod tests {
    use super::*;

    const ARM: &str = "http://127.0.0.1:4100/__lecter-test/figure-filter";

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap_or_else(|e| panic!("{text}: {e}"))
    }

    fn query(fig: &str, next: &str) -> String {
        format!("{ARM}?figure={fig}&figure=http%3A%2F%2F127.0.0.1%3A4200&page=http%3A%2F%2Ftauri.localhost&next={next}")
    }

    #[test]
    fn a_full_request_arms_with_its_origins_and_next() {
        let next = "http%3A%2F%2F127.0.0.1%3A4100%2Fharness.html%3Ftauri%3D1";
        let got = parse(&url(&query("http%3A%2F%2F127.0.0.1%3A4100", next)));
        let policy = Policy::new(&["http://127.0.0.1:4100", "http://127.0.0.1:4200"], &["http://tauri.localhost"]);
        let expected = policy.map(|policy| Arm { policy, next: url("http://127.0.0.1:4100/harness.html?tauri=1") });
        assert_eq!(got, Some(expected.map_err(|e| e.to_string())));
    }

    #[test]
    fn other_navigations_are_not_arm_requests() {
        for other in [
            "http://127.0.0.1:4100/harness.html",
            "http://127.0.0.1:4100/__lecter-test/figure-filter/x",
            "https://127.0.0.1:4100/__lecter-test/figure-filter",
            "http://example.com/__lecter-test/figure-filter",
            "http://tauri.localhost/__lecter-test/figure-filter",
            "tauri://localhost/__lecter-test/figure-filter",
        ] {
            assert_eq!(parse(&url(other)), None, "{other}");
        }
        for host in ["localhost", "[::1]"] {
            let u = url(&format!("http://{host}:4100{PATH}"));
            assert!(parse(&u).is_some_and(|r| r.is_err()), "{host} is loopback: refused for its query, not ignored");
        }
    }

    #[test]
    fn a_bad_request_is_refused_with_the_reason() {
        let ok_next = "http%3A%2F%2F127.0.0.1%3A4100%2Fh";
        let cases = [
            (query("nope", ok_next), "not an origin (scheme://host[:port]): \"nope\""),
            (
                query("http%3A%2F%2F127.0.0.1%3A4100", "http%3A%2F%2Fexample.com%2F"),
                "next must stay on http://127.0.0.1:4100",
            ),
            (query("http%3A%2F%2F127.0.0.1%3A4100", "%3A%3A"), "next: relative URL without a base"),
            (format!("{ARM}?figure=http%3A%2F%2F127.0.0.1%3A4100"), "exactly one next= is needed"),
            (format!("{ARM}?next={ok_next}"), "not an origin (scheme://host[:port]): \"\""),
        ];
        for (text, why) in cases {
            assert_eq!(parse(&url(&text)), Some(Err(why.to_owned())), "{text}");
        }
        let twice = format!("{}&next={ok_next}", query("http%3A%2F%2F127.0.0.1%3A4100", ok_next));
        assert_eq!(parse(&url(&twice)), Some(Err("exactly one next= is needed".to_owned())));
    }

    #[test]
    fn report_appends_the_outcome_to_next() {
        let next = url("http://127.0.0.1:4100/harness.html?tauri=1");
        assert_eq!(
            report(&next, &Ok("content-rule-list")).as_str(),
            "http://127.0.0.1:4100/harness.html?tauri=1&ff-filter=armed&ff-filter-kind=content-rule-list"
        );
        assert_eq!(
            report(&next, &Err("no store & no luck".to_owned())).as_str(),
            "http://127.0.0.1:4100/harness.html?tauri=1&ff-filter=failed&ff-filter-error=no+store+%26+no+luck"
        );
    }
}
