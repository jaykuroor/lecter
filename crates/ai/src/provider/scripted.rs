//! The scripted provider: plays a fixed list of timed text deltas in-process, with no network.
//! It is the fake provider of the tests (any script: slow first token, a stream that never ends)
//! and, until a real provider is connected, the app's offline sample provider (`sample`), whose
//! answer says plainly that it is a sample.

use std::sync::Arc;
use std::time::Duration;

use tokio_util::sync::CancellationToken;

use super::{BoxFuture, Caps, ChatRequest, EventSender, EventStream, Provider, StreamEvent};
use crate::Result;

/// One step of a script: wait `after`, then send `text`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Step {
    /// How long to wait before this delta.
    pub after: Duration,
    /// The delta.
    pub text: String,
}

/// A provider that answers every request with the same script.
#[derive(Debug, Clone)]
pub struct ScriptedProvider {
    id: String,
    steps: Arc<[Step]>,
}

/// The sample provider's id, which is also its one model's id.
pub const SAMPLE_ID: &str = "sample";

/// The sample provider's answer, streamed word by word.
pub const SAMPLE_ANSWER: &str = "**Sample answer.** No AI provider is connected yet, so Lecter shows this \
built-in sample instead of a real answer. Once a provider is connected, the answer to your question \
about this line streams in here, right under the line it explains. It is saved in the lecture file as \
a gloss, so it is still here after a restart. Press Esc while an answer streams to stop it.";

/// How long the sample waits before its first word, as a provider would.
pub const SAMPLE_FIRST_TOKEN: Duration = Duration::from_millis(400);

/// How long the sample waits between words: about a reading pace, so the stream can be watched.
pub const SAMPLE_WORD_PACE: Duration = Duration::from_millis(90);

impl ScriptedProvider {
    /// A provider called `id` that plays `steps` for every request.
    pub fn new(id: impl Into<String>, steps: Vec<Step>) -> Self {
        Self { id: id.into(), steps: steps.into() }
    }

    /// The offline sample provider: [`SAMPLE_ANSWER`] one word at a time.
    pub fn sample() -> Self {
        Self::new(SAMPLE_ID, words(SAMPLE_ANSWER, SAMPLE_FIRST_TOKEN, SAMPLE_WORD_PACE))
    }
}

/// `text` as one step per word (each word keeps the space before it): the first after `first`,
/// the others `pace` apart.
pub fn words(text: &str, first: Duration, pace: Duration) -> Vec<Step> {
    let mut steps: Vec<Step> = Vec::new();
    for (i, word) in text.split_inclusive(' ').enumerate() {
        steps.push(Step { after: if i == 0 { first } else { pace }, text: word.to_owned() });
    }
    steps
}

impl Provider for ScriptedProvider {
    fn id(&self) -> &str {
        &self.id
    }

    fn stream(&self, _req: ChatRequest, cancel: CancellationToken) -> BoxFuture<'_, Result<EventStream>> {
        let steps = Arc::clone(&self.steps);
        Box::pin(async move {
            let (tx, stream) = EventStream::channel();
            tokio::spawn(play(steps, tx, cancel));
            Ok(stream)
        })
    }

    fn capabilities(&self, _model: &str) -> Caps {
        Caps::default()
    }
}

/// Sends each step after its wait, then `Done`. Stops as soon as `cancel` fires or the reader
/// drops the stream, even in the middle of a wait.
async fn play(steps: Arc<[Step]>, tx: EventSender, cancel: CancellationToken) {
    for step in steps.iter() {
        tokio::select! {
            () = cancel.cancelled() => return,
            () = tx.closed() => return,
            () = tokio::time::sleep(step.after) => {}
        }
        if tx.send(Ok(StreamEvent::TextDelta(step.text.clone()))).await.is_err() {
            return;
        }
    }
    let _ = tx.send(Ok(StreamEvent::Done)).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn words_keep_every_character_and_pace_after_the_first() {
        let steps = words("one two  three", Duration::from_millis(5), Duration::from_millis(1));
        let texts: Vec<&str> = steps.iter().map(|s| s.text.as_str()).collect();
        assert_eq!(texts, ["one ", "two ", " ", "three"]);
        assert_eq!(texts.concat(), "one two  three");
        let waits: Vec<u64> = steps.iter().map(|s| s.after.as_millis() as u64).collect();
        assert_eq!(waits, [5, 1, 1, 1]);
        assert!(words("", Duration::ZERO, Duration::ZERO).is_empty());
    }

    #[test]
    fn the_sample_says_it_is_a_sample() {
        let p = ScriptedProvider::sample();
        assert_eq!(p.id(), "sample");
        let text: String = p.steps.iter().map(|s| s.text.as_str()).collect();
        assert_eq!(text, SAMPLE_ANSWER);
        assert!(text.starts_with("**Sample answer.**"));
        assert_eq!(p.steps[0].after, SAMPLE_FIRST_TOKEN);
        assert_eq!(p.steps[1].after, SAMPLE_WORD_PACE);
    }
}
