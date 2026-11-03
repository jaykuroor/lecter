use super::*;

const FIG: &str = "http://127.0.0.1:4100";
const LIB: &str = "http://127.0.0.1:4200";
const PAGE: &str = "http://tauri.localhost";

fn policy() -> Policy {
    let built = Policy::new(&[FIG, LIB], &[PAGE, "http://ipc.localhost"]);
    assert!(built.is_ok(), "{built:?}");
    built.unwrap_or_else(|_| Policy { figure: vec![], page: vec![] })
}

#[test]
fn a_frame_reaches_only_the_figure_origins_and_data() {
    let p = policy();
    for url in [
        "http://127.0.0.1:4100/frame/probe.js",
        "http://127.0.0.1:4200/lib/probe.js",
        "HTTP://127.0.0.1:4200/x",
        "data:image/png;base64,AAAA",
        "DATA:text/plain,x",
    ] {
        assert!(p.allows(url, Source::Frame), "{url} must pass from a frame");
    }
    for url in [
        // The network stand-in, another port on the same host, the page's own origins.
        "http://127.0.0.1:4300/beacon/fig-prefetch",
        "http://127.0.0.1:41000/x",
        "http://127.0.0.1/x",
        "https://127.0.0.1:4100/x",
        "ws://127.0.0.1:4100/x",
        "http://tauri.localhost/index.html",
        "http://ipc.localhost/app_info",
        "https://example.com/",
        "blob:http://127.0.0.1:4100/1234",
        "about:blank",
        "not a url",
        "",
    ] {
        assert!(!p.allows(url, Source::Frame), "{url} must be refused from a frame");
    }
}

#[test]
fn an_unattributed_request_also_reaches_the_page_origins() {
    let p = policy();
    for url in ["http://tauri.localhost/assets/a.js", "http://ipc.localhost/app_info", "http://127.0.0.1:4100/x"] {
        assert!(p.allows(url, Source::Any), "{url} must pass for the page");
    }
    for url in ["http://127.0.0.1:4300/beacon/x", "https://tauri.localhost/x", "http://evil.localhost/"] {
        assert!(!p.allows(url, Source::Any), "{url} must be refused for the page too");
    }
}

#[test]
fn custom_scheme_origins_match_by_scheme_and_host() {
    let built = Policy::new(&["lecter-fig://localhost", "lecter-lib://localhost"], &[]);
    let Ok(p) = built else {
        panic!("custom schemes are origins: {built:?}");
    };
    assert!(p.allows("lecter-fig://localhost/ab12.html", Source::Frame));
    assert!(p.allows("lecter-lib://LOCALHOST/d3@7.9.0/d3.js", Source::Frame));
    assert!(!p.allows("lecter://localhost/cache/ab12.png", Source::Frame));
    assert!(!p.allows("lecter-fig://other/ab12.html", Source::Frame));
}

#[test]
fn origins_with_more_than_scheme_host_port_are_refused() {
    for bad in [
        "http://127.0.0.1:4100/frame/",
        "http://127.0.0.1:4100/?q=1",
        "http://127.0.0.1:4100/#x",
        "http://user@127.0.0.1:4100",
        "http://user:pw@127.0.0.1:4100",
        "127.0.0.1:4100",
        "data:text/plain,x",
        "",
    ] {
        assert_eq!(Policy::new(&[bad], &[]), Err(BadOrigin(bad.to_owned())), "{bad:?}");
        assert!(Policy::new(&[FIG], &[bad]).is_err(), "page origin {bad:?}");
    }
    assert!(Policy::new(&["http://127.0.0.1:4100/"], &[]).is_ok(), "a bare trailing slash is still an origin");
}

#[test]
fn a_policy_needs_a_figure_origin() {
    assert_eq!(Policy::new::<&str>(&[], &[PAGE]), Err(BadOrigin(String::new())));
}

#[test]
fn webkit_rules_block_child_frames_then_allow_data_and_each_figure_origin() {
    let rules: serde_json::Value = serde_json::from_str(&policy().webkit_rules()).unwrap_or_default();
    let expected = serde_json::json!([
        { "trigger": { "url-filter": ".*", "load-context": ["child-frame"] }, "action": { "type": "block" } },
        { "trigger": { "url-filter": "^data:", "load-context": ["child-frame"] }, "action": { "type": "ignore-previous-rules" } },
        { "trigger": { "url-filter": r"^http://127\.0\.0\.1:4100/", "load-context": ["child-frame"] }, "action": { "type": "ignore-previous-rules" } },
        { "trigger": { "url-filter": r"^http://127\.0\.0\.1:4200/", "load-context": ["child-frame"] }, "action": { "type": "ignore-previous-rules" } },
    ]);
    assert_eq!(rules, expected);
}

#[test]
fn escape_covers_every_regex_metacharacter() {
    assert_eq!(escape(r"a.b*c+d?e^f$g(h)i[j]k{l}m|n\o-p:/"), r"a\.b\*c\+d\?e\^f\$g\(h\)i\[j\]k\{l\}m\|n\\o-p:/");
}

#[test]
fn bad_origin_names_the_text() {
    assert_eq!(BadOrigin("x/y".into()).to_string(), "not an origin (scheme://host[:port]): \"x/y\"");
}
