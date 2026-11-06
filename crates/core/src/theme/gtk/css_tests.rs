#![allow(clippy::disallowed_methods, reason = "tests build fixture files on plain test threads")]

use std::time::{Duration, Instant};

use proptest::prelude::*;

use super::*;
use crate::testenv::TestEnv;

fn colour(css: &str, name: &str) -> Option<String> {
    Defines::parse(css).resolver().get(name).map(|c| c.to_string())
}

#[test]
fn reads_hex_rgb_named_and_function_values() {
    let css = "@define-color a #3584e4;\n\
               @define-color b rgba(0, 0, 0, 0.35);\n\
               @define-color c rgb(100%, 0%, 50%);\n\
               @define-color d white;\n\
               @define-color e shade(#ff0000, 0.5);\n\
               @define-color f alpha(black, 0.5);\n\
               @define-color g mix(#000000, #ffffff, 0.5);\n\
               @define-color h lighter(#808080);\n\
               @define-color i darker(#808080);\n\
               @define-color j rgb(10 20 30 / 50%);\n\
               @define-color k RGBA( 255 , 255 , 255 , 1 );";
    assert_eq!(colour(css, "a").as_deref(), Some("#3584e4"));
    assert_eq!(colour(css, "b").as_deref(), Some("rgba(0, 0, 0, 0.35)"));
    assert_eq!(colour(css, "c").as_deref(), Some("#ff0080"));
    assert_eq!(colour(css, "d").as_deref(), Some("#ffffff"));
    assert_eq!(colour(css, "e").as_deref(), Some("#602020"));
    assert_eq!(colour(css, "f").as_deref(), Some("rgba(0, 0, 0, 0.5)"));
    assert_eq!(colour(css, "g").as_deref(), Some("#808080"));
    // lighter = shade 1.3, darker = shade 0.7 (GTK): 128/255 × 1.3 → 166.4, × 0.7 → 89.6.
    assert_eq!(colour(css, "h").as_deref(), Some("#a6a6a6"));
    assert_eq!(colour(css, "i").as_deref(), Some("#5a5a5a"));
    assert_eq!(colour(css, "j").as_deref(), Some("rgba(10, 20, 30, 0.5)"));
    assert_eq!(colour(css, "k").as_deref(), Some("#ffffff"));
}

#[test]
fn references_resolve_through_other_names_in_any_order() {
    let css = "@define-color theme_bg_color @bg_breeze;\n\
               @define-color insensitive alpha(@theme_bg_color, 0.5);\n\
               @define-color bg_breeze #eff0f1;";
    assert_eq!(colour(css, "theme_bg_color").as_deref(), Some("#eff0f1"));
    assert_eq!(colour(css, "insensitive").as_deref(), Some("rgba(239, 240, 241, 0.5)"));
}

#[test]
fn a_later_definition_replaces_an_earlier_one() {
    let css = "@define-color accent #111111; @define-color accent #222222;";
    assert_eq!(colour(css, "accent").as_deref(), Some("#222222"));
}

#[test]
fn comments_strings_and_other_rules_hide_nothing_and_define_nothing() {
    let css = "/* @define-color a #ff0000; */\n\
               .x { content: \"@define-color b #00ff00;\"; }\n\
               @import url(\"other.css\");\n\
               window { color: @c; }\n\
               @define-color c #0000ff;";
    let defines = Defines::parse(css);
    assert_eq!(defines.len(), 1, "{defines:?}");
    assert_eq!(colour(css, "a"), None);
    assert_eq!(colour(css, "b"), None);
    assert_eq!(colour(css, "c").as_deref(), Some("#0000ff"));
}

#[test]
fn import_is_never_followed() {
    let env = TestEnv::new().unwrap();
    let other = env.home().join("other.css");
    std::fs::write(&other, "@define-color secret #abcdef;").unwrap();
    let css = format!("@import url(\"file://{}\");\n@import \"{}\";", other.display(), other.display());
    let defines = Defines::parse(&css);
    assert!(defines.is_empty(), "{defines:?}");
}

#[test]
fn malformed_statements_are_skipped_and_parsing_goes_on() {
    let css = "@define-color nosemicolon #fff }\n\
               @define-color ; \n\
               @define-color empty ;\n\
               @define-color fn unknown(#fff);\n\
               @define-color trailing #fff garbage;\n\
               @define-color badhex #ggg;\n\
               @define-color badnum alpha(#fff, x);\n\
               @define-color unclosed shade(#fff, 0.5;\n\
               @define-color nocomma mix(#fff #000 0.5);\n\
               @define-color good #123456;";
    assert_eq!(colour(css, "good").as_deref(), Some("#123456"));
    for bad in ["nosemicolon", "empty", "fn", "trailing", "badhex", "badnum", "unclosed", "nocomma"] {
        assert_eq!(colour(css, bad), None, "{bad}");
    }
}

#[test]
fn an_unterminated_last_statement_defines_nothing() {
    assert_eq!(colour("@define-color a #fff", "a"), None);
    assert_eq!(colour("/* never closed @define-color a #fff;", "a"), None);
    assert_eq!(colour("'never closed @define-color a #fff;", "a"), None);
}

#[test]
fn cycles_and_self_references_resolve_to_nothing() {
    let css = "@define-color a @b; @define-color b @a; @define-color c @c; @define-color d mix(@a, #fff, 0.5);";
    for name in ["a", "b", "c", "d"] {
        assert_eq!(colour(css, name), None, "{name}");
    }
}

#[test]
fn a_reference_chain_deeper_than_the_limit_resolves_to_nothing() {
    let mut css = String::from("@define-color n0 #010203;\n");
    for i in 1..=60 {
        css.push_str(&format!("@define-color n{i} @n{};\n", i - 1));
    }
    assert_eq!(colour(&css, "n3").as_deref(), Some("#010203"));
    assert_eq!(colour(&css, &format!("n{}", MAX_DEPTH - 1)).as_deref(), Some("#010203"));
    assert_eq!(colour(&css, "n60"), None);
}

#[test]
fn deeply_nested_functions_end_without_overflowing_the_stack() {
    let depth = 100_000;
    let css = format!("@define-color x {}#fff{};", "shade(".repeat(depth), ", 1)".repeat(depth));
    // The value is over MAX_VALUE_BYTES, so it is dropped outright.
    assert_eq!(colour(&css, "x"), None);
    let nested = format!("@define-color y {}#fff{};", "lighter(".repeat(40), ")".repeat(40));
    assert!(nested.len() < MAX_VALUE_BYTES + 20);
    assert_eq!(colour(&nested, "y"), None, "40 levels is past MAX_DEPTH");
    let shallow = format!("@define-color z {}#000{};", "lighter(".repeat(3), ")".repeat(3));
    assert_eq!(colour(&shallow, "z").as_deref(), Some("#000000"));
}

#[test]
fn an_exponential_reference_graph_finishes_quickly() {
    // Each name mixes the next one twice: 2^40 evaluations without the memo and step budget.
    let mut css = String::from("@define-color e40 #808080;\n");
    for i in (0..40).rev() {
        css.push_str(&format!("@define-color e{i} mix(@e{n}, @e{n}, 0.5);\n", n = i + 1));
    }
    let started = Instant::now();
    let defines = Defines::parse(&css);
    let mut resolver = defines.resolver();
    let _ = resolver.get("e0");
    assert!(started.elapsed() < Duration::from_secs(1), "{:?}", started.elapsed());
    assert_eq!(resolver.get("e30").map(|c| c.to_string()).as_deref(), Some("#808080"));
}

#[test]
fn the_step_budget_ends_evaluation() {
    let mut css = String::new();
    // Fifteen expressions each: seven mixes over eight leaves.
    let leaf = "mix(mix(#000, #fff, 0.5), mix(#000, #fff, 0.5), 0.5)";
    let value = format!("mix({leaf}, {leaf}, 0.5)");
    for i in 0..MAX_DEFINES {
        css.push_str(&format!("@define-color s{i} {value};\n"));
    }
    let defines = Defines::parse(&css);
    let mut resolver = defines.resolver();
    let resolved = (0..MAX_DEFINES).filter(|i| resolver.get(&format!("s{i}")).is_some()).count();
    // The budget covers MAX_STEPS / 15 of them, no more.
    assert_eq!(resolved, MAX_STEPS / 15);
}

#[test]
fn names_values_and_definitions_are_capped() {
    let long_name = "n".repeat(MAX_NAME_BYTES + 1);
    let ok_name = "n".repeat(MAX_NAME_BYTES);
    let css = format!("@define-color {long_name} #fff; @define-color {ok_name} #fff;");
    assert_eq!(colour(&css, &long_name), None);
    assert_eq!(colour(&css, &ok_name).as_deref(), Some("#ffffff"));

    let long_value = format!("rgb(1, 2, 3{})", " ".repeat(MAX_VALUE_BYTES));
    assert_eq!(colour(&format!("@define-color v {long_value};"), "v"), None);
    let ok_value = format!("rgb(1, 2,{}3)", " ".repeat(MAX_VALUE_BYTES - 11));
    assert_eq!(ok_value.len(), MAX_VALUE_BYTES);
    assert_eq!(colour(&format!("@define-color v {ok_value};"), "v").as_deref(), Some("#010203"));

    let mut many = String::new();
    for i in 0..MAX_DEFINES + 10 {
        many.push_str(&format!("@define-color c{i} #fff;"));
    }
    many.push_str("@define-color c0 #000;");
    let defines = Defines::parse(&many);
    assert_eq!(defines.len(), MAX_DEFINES);
    assert_eq!(
        defines.resolver().get("c0").map(|c| c.to_string()).as_deref(),
        Some("#000000"),
        "redefining a kept name"
    );
    assert_eq!(defines.resolver().get(&format!("c{MAX_DEFINES}")), None);
}

#[test]
fn read_css_refuses_a_file_over_the_cap_and_reads_one_at_it() {
    let env = TestEnv::new().unwrap();
    let at = env.home().join("at.css");
    let over = env.home().join("over.css");
    let cap = usize::try_from(MAX_CSS_BYTES).unwrap();
    std::fs::write(&at, vec![b' '; cap]).unwrap();
    std::fs::write(&over, vec![b' '; cap + 1]).unwrap();
    assert_eq!(read_css(&at).unwrap().len(), cap);
    assert!(matches!(read_css(&over), Err(CssError::TooLarge)));
    assert!(matches!(read_css(&env.home().join("missing.css")), Err(CssError::Io(_))));
}

#[test]
fn read_css_replaces_invalid_utf8() {
    let env = TestEnv::new().unwrap();
    let path = env.home().join("bad.css");
    std::fs::write(&path, b"@define-color a #fff; /* \xff\xfe */ @define-color b #000;").unwrap();
    let css = read_css(&path).unwrap();
    assert_eq!(colour(&css, "b").as_deref(), Some("#000000"));
}

/// D-237: parse time of an Adwaita-sized theme. Set LECTER_GTK_BENCH_CSS to a real gtk.css to
/// measure that instead; the numbers print with `--nocapture`.
#[test]
fn a_large_theme_parses_in_a_few_milliseconds() {
    let css = match std::env::var_os("LECTER_GTK_BENCH_CSS") {
        Some(path) => read_css(std::path::Path::new(&path)).unwrap(),
        None => synthetic_theme(700_000),
    };
    let mut times = Vec::new();
    for _ in 0..21 {
        let started = Instant::now();
        let defines = Defines::parse(&css);
        let mut resolver = defines.resolver();
        let _ = resolver.get("theme_bg_color");
        times.push(started.elapsed());
    }
    times.sort();
    println!("gtk.css {} bytes: parse median {:?}, max {:?}", css.len(), times[10], times[20]);
    assert!(times[10] < Duration::from_millis(50), "{times:?}");
}

/// A theme like the big real ones: a few dozen @define-color lines, then hundreds of KB of rules.
fn synthetic_theme(bytes: usize) -> String {
    let mut css = String::from("@define-color theme_bg_color #f7f7f7;\n@define-color borders rgba(0, 0, 0, 0.15);\n");
    for i in 0..48 {
        css.push_str(&format!("@define-color named_{i} shade(@theme_bg_color, 0.9{i});\n"));
    }
    let mut i = 0;
    while css.len() < bytes {
        css.push_str(&format!(
            ".button:hover:not(:disabled) > .label-{i} {{ color: @named_7; background-image: linear-gradient(to bottom, alpha(@borders, 0.5), transparent); /* rule {i} */ }}\n"
        ));
        i += 1;
    }
    css
}

/// Whether `text` is CSS colour text as `Rgba`'s Display writes it, and nothing else.
fn is_formatted_colour(text: &str) -> bool {
    if let Some(hex) = text.strip_prefix('#') {
        return hex.len() == 6 && hex.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
    }
    let Some(inner) = text.strip_prefix("rgba(").and_then(|t| t.strip_suffix(')')) else { return false };
    let parts: Vec<&str> = inner.split(", ").collect();
    parts.len() == 4
        && parts[..3].iter().all(|p| p.parse::<u8>().is_ok())
        && parts[3].parse::<f64>().is_ok_and(|a| (0.0..1.0).contains(&a))
}

#[test]
fn formatted_colours_are_recognised() {
    assert!(is_formatted_colour("#0a0b0c"));
    assert!(is_formatted_colour("rgba(1, 2, 3, 0.5)"));
    for bad in ["#0A0B0C", "#fff", "rgba(1, 2, 3, 1)", "rgba(1, 2, 256, 0.5)", "red", "rgba(1, 2, 3)", "#0a0b0c;x"] {
        assert!(!is_formatted_colour(bad), "{bad}");
    }
}

/// Theme-like text: definitions, colour syntax, functions and punctuation in any order.
const THEME_TEXT: &str =
    "(@define-color [a-c@]{0,3} |[#(),;@/*'\"a-f0-9 .%]|shade\\(|mix\\(|alpha\\(|rgba\\(|white){0,60}";

proptest! {
    /// Whatever a theme writes, a name resolves to nothing or to colour text this crate
    /// formatted: nothing from the file reaches the UI's CSS verbatim, and the caps hold.
    #[test]
    fn any_text_resolves_only_to_formatted_colours(
        css in THEME_TEXT
    ) {
        let defines = Defines::parse(&css);
        prop_assert!(defines.len() <= MAX_DEFINES);
        let mut resolver = defines.resolver();
        for name in ["a", "b", "c", "ab", "ac", "abc", ""] {
            if let Some(c) = resolver.get(name) {
                let text = c.to_string();
                prop_assert!(is_formatted_colour(&text), "{} = {} from {:?}", name, text, css);
            }
        }
    }

    /// Arbitrary bytes resolve only to formatted colours, and can't change a definition before them.
    #[test]
    fn any_bytes_resolve_only_to_formatted_colours(bytes in proptest::collection::vec(any::<u8>(), 0..300)) {
        let css = String::from_utf8_lossy(&bytes);
        if let Some(c) = Defines::parse(&css).resolver().get("a") {
            prop_assert!(is_formatted_colour(&c.to_string()));
        }
        let prefixed = format!("@define-color known #102030;\n{css}");
        if !css.contains("known") {
            let got = Defines::parse(&prefixed).resolver().get("known").map(|c| c.to_string());
            prop_assert_eq!(got.as_deref(), Some("#102030"));
        }
    }
}
