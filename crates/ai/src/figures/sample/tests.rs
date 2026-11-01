use super::*;
use crate::gloss::{GlossDiv, fenced_div};
use crate::prompt::ask_request;

const LECTURE: &str = "::: {.slide #s1 n=1}\n[Plot the graph of a parabola.]{#s1b1}\n:::\n";

fn ask(question: &str) -> ChatRequest {
    ask_request(LECTURE, "s1b1", question, SAMPLE_ID).unwrap_or_else(|e| panic!("{e}"))
}

/// The spec of 08-figures.md#tiers, exactly as the sample sends it.
const SPEC: &str = "{\"type\": \"fnplot\", \"exprs\": [\"x^2\"], \"x\": [-1, 1], \"params\": {\"n\": {\"min\": 10, \"max\": 1000, \"value\": 100}}, \"scatter\": {\"sample\": \"x ~ U(-1,1); y = x^2\", \"n\": \"n\"}}";

#[test]
fn plot_words_ask_for_a_plot_at_the_start_of_any_word_in_any_case() {
    for q in [
        "Can you plot this?",
        "PLOTTING it would help",
        "show me a graph",
        "a chart, please",
        "what does the figure look like",
        "Draw it",
        "sketch y=x^2",
        "plots!",
    ] {
        assert!(asks_for_plot(q), "{q:?} asks for a plot");
    }
    for q in ["Why is covariance bilinear?", "", "an explot", "subgraph", "redraw"] {
        assert!(!asks_for_plot(q), "{q:?} doesn't ask for a plot");
    }
}

#[test]
fn a_plot_question_gets_the_plot_and_any_other_the_text_answer() {
    assert_eq!(answer_for(&ask("Could you plot it?")), SAMPLE_PLOT_ANSWER);
    assert_eq!(answer_for(&ask("Why?")), SAMPLE_ANSWER);
}

/// The slide says "Plot the graph", but only the student's question chooses the answer.
#[test]
fn slide_text_never_chooses_the_plot() {
    assert_eq!(answer_for(&ask("what does this mean")), SAMPLE_ANSWER);
    // Without the wrapper the whole message is the question.
    let bare = ChatRequest {
        model: SAMPLE_ID.into(),
        system: String::new(),
        messages: vec![crate::provider::Message { role: crate::provider::Role::User, content: "graph it".into() }],
        max_output_tokens: 16,
    };
    assert_eq!(answer_for(&bare), SAMPLE_PLOT_ANSWER);
    let empty = ChatRequest { messages: vec![], ..bare };
    assert_eq!(answer_for(&empty), SAMPLE_ANSWER);
}

#[test]
fn the_plot_answer_says_it_is_a_sample_and_carries_the_spec_in_an_fnplot_fence() {
    assert!(SAMPLE_PLOT_ANSWER.starts_with("**Sample answer.**"));
    assert!(SAMPLE_PLOT_ANSWER.ends_with(&format!("\n\n```fnplot\n{SPEC}\n```")), "{SAMPLE_PLOT_ANSWER}");
}

/// Saved as a gloss, the spec's lines stay exactly as sent: none of them is escaped.
#[test]
fn the_spec_survives_the_gloss_escaping_unchanged() {
    let div = fenced_div(&GlossDiv {
        id: "g-0001",
        kind: "ask",
        key: "a",
        anchor: "s1b1",
        model: SAMPLE_ID,
        question: "plot it",
        answer: SAMPLE_PLOT_ANSWER,
    });
    assert!(div.ends_with(&format!("\n```fnplot\n{SPEC}\n```\n:::")), "{div}");
    assert!(!div.contains('\\'), "{div}");
}

#[test]
fn the_sample_provider_is_the_sample() {
    assert_eq!(SampleProvider.id(), "sample");
    assert_eq!(SampleProvider.capabilities("sample"), Caps::default());
}

/// The stream plays the chosen answer word by word: its first word comes after the sample's wait.
#[tokio::test]
async fn the_sample_provider_streams_its_answer() {
    let mut stream =
        SampleProvider.stream(ask("plot it"), CancellationToken::new()).await.unwrap_or_else(|e| panic!("{e}"));
    let first = stream.next().await;
    assert_eq!(first, Some(Ok(crate::provider::StreamEvent::TextDelta("**Sample ".into()))));
}
