//! The answer loop of the skeleton (`06-ai-harness.md#loop`, steps 2 and 4): stream from the
//! provider, hand each text delta on as it arrives, and stop at the end of the turn, at the role's
//! time budget or on `Esc` (the cancel token). Tools, post-checks and usage come with F-088.

use std::time::Duration;

use tokio_util::sync::CancellationToken;

use crate::provider::{ChatRequest, Provider, StreamEvent};
use crate::{Error, Result};

/// The time budget of `a` (`06-ai-harness.md#loop` step 4).
pub const ASK_TIME_BUDGET: Duration = Duration::from_secs(30);

/// How an answer's stream ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum End {
    /// The provider finished the turn.
    Finished,
    /// The cancel token fired (`Esc`, or the app shutting down).
    Cancelled,
    /// The role's time budget ran out first.
    OutOfTime,
}

/// The answer as far as it streamed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Answer {
    /// Every delta, in order.
    pub text: String,
    /// Why the stream ended.
    pub end: End,
}

/// Streams the answer to `req` from `provider`, calling `on_delta` with each piece of text as it
/// arrives. Returns as soon as `cancel` fires or `budget` runs out, with the text so far; the
/// provider's stream is dropped then, which stops it too.
pub async fn stream_answer(
    provider: &dyn Provider,
    req: ChatRequest,
    cancel: &CancellationToken,
    budget: Duration,
    mut on_delta: impl FnMut(&str),
) -> Result<Answer> {
    let deadline = tokio::time::Instant::now() + budget;
    let mut text = String::new();
    let mut stream = tokio::select! {
        biased;
        () = cancel.cancelled() => return Ok(Answer { text, end: End::Cancelled }),
        () = tokio::time::sleep_until(deadline) => return Ok(Answer { text, end: End::OutOfTime }),
        s = provider.stream(req, cancel.clone()) => s?,
    };
    loop {
        let event = tokio::select! {
            biased;
            () = cancel.cancelled() => return Ok(Answer { text, end: End::Cancelled }),
            () = tokio::time::sleep_until(deadline) => return Ok(Answer { text, end: End::OutOfTime }),
            e = stream.next() => e,
        };
        match event {
            Some(Ok(StreamEvent::TextDelta(delta))) => {
                text.push_str(&delta);
                on_delta(&delta);
            }
            Some(Ok(StreamEvent::Done)) => return Ok(Answer { text, end: End::Finished }),
            Some(Err(e)) => return Err(e),
            // The provider stopped without finishing: it was cancelled or broke off.
            None if cancel.is_cancelled() => return Ok(Answer { text, end: End::Cancelled }),
            None => return Err(Error::Provider("the stream ended before the answer did".into())),
        }
    }
}
