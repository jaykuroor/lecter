use proptest::prelude::*;

use super::*;

fn s(text: &str) -> Value {
    Value::Str(text.to_owned())
}

#[test]
fn reads_the_scalar_forms_gdbus_prints() {
    assert_eq!(parse("'Adwaita'"), Some(s("Adwaita")));
    assert_eq!(parse("\"it's\""), Some(s("it's")));
    assert_eq!(parse(r"'a\'b\\c\nd'"), Some(s("a'b\\c\nd")));
    assert_eq!(parse("uint32 1"), Some(Value::Num(1.0)));
    assert_eq!(parse("int32 -3"), Some(Value::Num(-3.0)));
    assert_eq!(parse("0.5"), Some(Value::Num(0.5)));
    assert_eq!(parse("byte 0x1f"), Some(Value::Num(31.0)));
    assert_eq!(parse("24"), Some(Value::Num(24.0)));
    assert_eq!(parse("true"), Some(Value::Bool(true)));
    assert_eq!(parse("false"), Some(Value::Bool(false)));
    assert_eq!(parse("<'x'>"), Some(s("x")));
    assert_eq!(parse("<<uint32 2>>"), Some(Value::Num(2.0)));
    assert_eq!(parse("  'padded'  \n"), Some(s("padded")));
}

#[test]
fn reads_tuples_arrays_and_dictionaries() {
    assert_eq!(parse("(0.25, 0.5, 1.0)"), Some(Value::List(vec![Value::Num(0.25), Value::Num(0.5), Value::Num(1.0)])));
    assert_eq!(parse("('a',)"), Some(Value::List(vec![s("a")])));
    assert_eq!(parse("()"), Some(Value::List(vec![])));
    assert_eq!(parse("['x', 'y']"), Some(Value::List(vec![s("x"), s("y")])));
    assert_eq!(parse("@a{sv} {}"), Some(Value::Dict(vec![])));
    let dict = parse("{'k': <uint32 1>, 'j': <'v'>}").unwrap();
    assert_eq!(dict.get("k"), Some(&Value::Num(1.0)));
    assert_eq!(dict.get("j"), Some(&s("v")));
    assert_eq!(dict.get("missing"), None);
    assert_eq!(s("x").get("k"), None);
    assert_eq!(Value::Num(1.0).as_str(), None);
}

#[test]
fn refuses_malformed_text() {
    for bad in [
        "",
        "'unterminated",
        "(1, 2",
        "{'k' 1}",
        "{'k': 1",
        "<'x'",
        "[1 2]",
        "nan",
        "inf",
        "1e999",
        "word",
        "'a' 'b'",
        "uint32",
        "0xzz",
    ] {
        assert_eq!(parse(bad), None, "{bad:?}");
    }
}

#[test]
fn refuses_text_that_is_too_long_or_too_deep() {
    let long = format!("'{}'", "a".repeat(MAX_TEXT_BYTES));
    assert_eq!(parse(&long), None);
    let fits = format!("'{}'", "a".repeat(MAX_TEXT_BYTES - 2));
    assert!(parse(&fits).is_some());
    let deep = format!("{}1{}", "(".repeat(10_000), ")".repeat(10_000));
    assert_eq!(parse(&deep), None);
    let ok = format!("{}1{}", "(".repeat(MAX_DEPTH), ")".repeat(MAX_DEPTH));
    assert!(parse(&ok).is_some());
    let over = format!("{}1{}", "(".repeat(MAX_DEPTH + 1), ")".repeat(MAX_DEPTH + 1));
    assert_eq!(parse(&over), None);
}

/// GVariant-like text: brackets, quotes, separators and words in any order.
const VARIANT_TEXT: &str = "[(){}<>\\[\\]',:@a-z0-9. \\\\\"]{0,80}";
/// Plain string contents.
const PLAIN: &str = "[a-zA-Z0-9 .:-]{0,40}";

proptest! {
    /// Whitespace around a value never changes what it parses to, whatever the text.
    #[test]
    fn surrounding_whitespace_never_matters(text in VARIANT_TEXT) {
        prop_assert_eq!(parse(&text), parse(&format!(" \n{text}\t ")));
    }

    /// Strings and numbers in a tuple come back as written.
    #[test]
    fn strings_and_numbers_round_trip(s in PLAIN, n in -1.0e6f64..1.0e6) {
        let text = format!("('{s}', <double {n}>, uint32 7)");
        prop_assert_eq!(parse(&text), Some(Value::List(vec![Value::Str(s), Value::Num(n), Value::Num(7.0)])));
    }
}
