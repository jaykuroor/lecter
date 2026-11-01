//! The offline sample provider (D-131) with its one figure: a question that asks for a plot gets
//! [`SAMPLE_PLOT_ANSWER`], whose function plot spec (`08-figures.md#tiers`) the UI draws locally;
//! any other question gets the sample text answer. Both say plainly that they are samples.

use tokio_util::sync::CancellationToken;

use crate::Result;
use crate::provider::scripted::{
    SAMPLE_ANSWER, SAMPLE_FIRST_TOKEN, SAMPLE_ID, SAMPLE_WORD_PACE, ScriptedProvider, words,
};
use crate::provider::{BoxFuture, Caps, ChatRequest, EventStream, Provider};

/// The sample answer to a request for a plot: a sentence, then the function plot spec of
/// `08-figures.md#tiers` in a fenced code block whose info string is `fnplot`, on one line (so no
/// line of it starts with `[` or `:::`, which the gloss would escape).
pub const SAMPLE_PLOT_ANSWER: &str = "**Sample answer.** No AI provider is connected yet, so Lecter \
shows this built-in sample plot instead of a real answer: y = x² on [-1, 1], with 100 random points \
on the curve. Lecter draws it on this computer from the spec below; nothing is fetched.\n\n```fnplot\n\
{\"type\": \"fnplot\", \"exprs\": [\"x^2\"], \"x\": [-1, 1], \"params\": {\"n\": {\"min\": 10, \"max\": 1000, \
\"value\": 100}}, \"scatter\": {\"sample\": \"x ~ U(-1,1); y = x^2\", \"n\": \"n\"}}\n```";

/// Words that ask for a figure, matched at the start of a word of the question, any case
/// (`plot`, `plots`, `plotting`, `Graph`, …).
const PLOT_WORDS: [&str; 6] = ["plot", "graph", "chart", "figure", "draw", "sketch"];

/// Whether `question` asks for a plot: one of its words starts with a word of [`PLOT_WORDS`].
pub fn asks_for_plot(question: &str) -> bool {
    question
        .split(|c: char| !c.is_alphanumeric())
        .map(str::to_lowercase)
        .any(|word| PLOT_WORDS.iter().any(|w| word.starts_with(w)))
}

/// The student's question in an ask request: the text after the `<untrusted_source>` wrapper
/// (`prompt::ask_request`), so slide text never chooses the answer; all of it when there is none.
fn question(req: &ChatRequest) -> &str {
    let content = req.messages.last().map_or("", |m| m.content.as_str());
    content.rsplit_once("</untrusted_source>").map_or(content, |(_, q)| q)
}

/// The sample's answer to `req`: [`SAMPLE_PLOT_ANSWER`] when the question asks for a plot,
/// otherwise the sample text answer ([`SAMPLE_ANSWER`]).
pub fn answer_for(req: &ChatRequest) -> &'static str {
    if asks_for_plot(question(req)) { SAMPLE_PLOT_ANSWER } else { SAMPLE_ANSWER }
}

/// The app's offline provider: [`answer_for`] the request, one word at a time, paced like
/// [`ScriptedProvider::sample`].
#[derive(Debug, Clone, Copy, Default)]
pub struct SampleProvider;

impl Provider for SampleProvider {
    fn id(&self) -> &str {
        SAMPLE_ID
    }

    fn stream(&self, req: ChatRequest, cancel: CancellationToken) -> BoxFuture<'_, Result<EventStream>> {
        let script = ScriptedProvider::new(SAMPLE_ID, words(answer_for(&req), SAMPLE_FIRST_TOKEN, SAMPLE_WORD_PACE));
        Box::pin(async move { script.stream(req, cancel).await })
    }

    fn capabilities(&self, _model: &str) -> Caps {
        Caps::default()
    }
}

#[cfg(test)]
mod tests;
