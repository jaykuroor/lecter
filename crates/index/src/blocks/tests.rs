use super::*;

/// The body example of 03-lecture-files.md#body, under a front matter, with a gloss and a note
/// that are not blocks.
const LECTURE: &str = r#"---
lecter: 1
lecture: 7
date: 2026-10-23
title: Covariance and Correlation
slides:
  - slides/07-covariance.pdf
---

::: {.slide #s3 n=3 src="A3" title="Properties"}
## Properties

[$\operatorname{Cov}(aX+b,cY+d)=ac\,\operatorname{Cov}(X,Y)$]{#s3b1}

[$\operatorname{Var}(X+Y)=\operatorname{Var}X+\operatorname{Var}Y+2\operatorname{Cov}(X,Y)$]{#s3b2 .flag}

::: {.gloss #g-7f3a kind=steps key=s anchor=s3b2 model="claude-haiku" by=ai vote=+1 variant=2/2}
**you asked:** how do we get the 2Cov term?

1. Expand $(X+Y-\mu_X-\mu_Y)^2$ ...
:::

::: {.note #n-91c0 anchor=s3b2}
Try it with numbers.
:::
:::
"#;

fn block(slide: &str, id: &str, text: &str, crumb: &str, source: &str, flagged: bool) -> Block {
    Block {
        slide: slide.into(),
        block: id.into(),
        text: text.into(),
        breadcrumb: crumb.into(),
        source: source.into(),
        flagged,
    }
}

#[test]
fn the_spec_example_has_two_blocks_with_their_slide_and_block_ids() {
    let crumb = "Covariance and Correlation › Properties";
    assert_eq!(
        lecture_blocks(LECTURE),
        [
            block("s3", "s3b1", r"$\operatorname{Cov}(aX+b,cY+d)=ac\,\operatorname{Cov}(X,Y)$", crumb, "A3", false),
            block(
                "s3",
                "s3b2",
                r"$\operatorname{Var}(X+Y)=\operatorname{Var}X+\operatorname{Var}Y+2\operatorname{Cov}(X,Y)$",
                crumb,
                "A3",
                true
            ),
        ]
    );
}

#[test]
fn each_block_takes_the_slide_it_is_under() {
    let text = "::: {.slide #s1 n=1 title=\"One\"}\n## One\n\n[a]{#s1b1}\n:::\n\n::: {.slide #s2 n=2 .flag}\n## Two words\n\n[b]{#s2b1}\n[c]{#s2b2}\n:::\n";
    assert_eq!(
        lecture_blocks(text),
        [
            block("s1", "s1b1", "a", "One", "", false),
            // No `title=`: the `## ` line names the slide; a slide-level flag flags its blocks.
            block("s2", "s2b1", "b", "Two words", "", true),
            block("s2", "s2b2", "c", "Two words", "", true),
        ]
    );
}

#[test]
fn only_exact_block_spans_are_blocks() {
    let text = [
        "::: {.slide #s1 n=1 title=\"T\"}",
        "[no id]",
        "[gloss id]{#g-7f3a}",
        "[bad id]{#s1}",
        "[bad id]{#s1bx}",
        " [indented]{#s1b1}",
        "[trailing text]{#s1b2} more",
        "[id glued to a class]{#s1b3.flag}",
        "plain [inline]{#s1b4} span",
        "[two]{#s1b5}{#s1b6}",
        "[ok]{#s1b7}   ",
        "[a]{x} and [b]{#s1b8 .flag key=\"v\"}",
        ":::",
    ]
    .join("\n");
    assert_eq!(
        lecture_blocks(&text),
        [block("s1", "s1b7", "ok", "T", "", false), block("s1", "s1b8", "a]{x} and [b", "T", "", true)]
    );
}

#[test]
fn front_matter_is_never_read_as_blocks_and_a_file_without_one_has_no_lecture_title() {
    let text = "---\ntitle: 'Quoted'\nnote: [x]{#s9b9}\n---\n[y]{#s1b1}\n";
    assert_eq!(lecture_blocks(text), [block("s1", "s1b1", "y", "Quoted", "", false)]);
    let bare = "[y]{#s1b1}\n";
    assert_eq!(lecture_blocks(bare), [block("s1", "s1b1", "y", "", "", false)]);
}

#[test]
fn an_unclosed_front_matter_is_not_front_matter() {
    let text = "---\n[y]{#s1b1}\n";
    assert_eq!(lecture_blocks(text), [block("s1", "s1b1", "y", "", "", false)]);
}

#[test]
fn non_slide_fences_keep_the_current_slide() {
    let text = "::: {.slide #s4 src=\"B4\" title=\"Four\"}\n::: {.gloss #g-1234 title=\"Not a slide\"}\n:::\n[z]{#s4b1}\n:::\n";
    assert_eq!(lecture_blocks(text), [block("s4", "s4b1", "z", "Four", "B4", false)]);
}

#[test]
fn attributes_parse_ids_classes_and_quoted_and_bare_values() {
    let attrs = parse_attrs(r#"#s3 .slide n=3 src="A 3" title="" .flag junk ="x" k=v"#);
    assert_eq!(attrs.id, "s3");
    assert_eq!(attrs.classes, ["slide", "flag"]);
    assert_eq!(attrs.value("n"), Some("3"));
    assert_eq!(attrs.value("src"), Some("A 3"));
    assert_eq!(attrs.value("title"), Some(""));
    assert_eq!(attrs.value("k"), Some("v"));
    assert_eq!(attrs.value("junk"), None);
}

#[test]
fn slide_fences_need_three_colons_braces_and_the_slide_class() {
    assert!(slide_fence("::: {.slide #s1}").is_some());
    assert!(slide_fence("::::{.slide #s1}  ").is_some());
    for not in [":: {.slide #s1}", "::: {.gloss #s1}", "::: .slide", "::: {.slide #s1", "::: {.slide} }"] {
        assert!(slide_fence(not).is_none(), "{not}");
    }
}

#[test]
fn slide_ids_come_from_block_ids() {
    assert_eq!(slide_of("s3b1"), Some("s3"));
    assert_eq!(slide_of("s12b30"), Some("s12"));
    for bad in ["s3", "sb1", "s3b", "x3b1", "s3b1x", "s-3b1", ""] {
        assert_eq!(slide_of(bad), None, "{bad}");
    }
}

/// Where the text ends is the buffer's regex `^\[(.*)\]\{(#s\d+b\d+(?:\s[^}]*)?)\}\s*$`: the
/// attributes hold no `}` and start with a block id, so an earlier `]{` can be the one.
#[test]
fn the_text_ends_at_the_last_bracket_brace_whose_attributes_fit() {
    let spans = |line: &str| block_span(line).map(|(text, attrs)| (text.to_owned(), attrs.id));
    // The last `]{` has no block id: the one before it does, and its attributes run to the end.
    assert_eq!(spans("[a]{#s1b1 ]{b}"), Some(("a".to_owned(), "s1b1".to_owned())));
    assert_eq!(spans("[a]{#s1b1 ]{#bad}"), Some(("a".to_owned(), "s1b1".to_owned())));
    // Attributes that start with a block id but hold a `}` don't fit.
    assert_eq!(spans("[a]{#s1b1 x}y}"), None);
}

#[test]
fn attribute_tokens_need_a_name() {
    // A bare `#` or `.` names nothing and changes nothing; neither does a value without a key.
    let attrs = parse_attrs("#s3 # . .flag =x data-n=1 my_key=2");
    assert_eq!(attrs.id, "s3");
    assert_eq!(attrs.classes, ["flag"]);
    assert_eq!(attrs.values, [("data-n".to_owned(), "1".to_owned()), ("my_key".to_owned(), "2".to_owned())]);
}
