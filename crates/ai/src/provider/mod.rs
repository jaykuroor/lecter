//! Providers (`07-providers.md#adapters-one-rust-trait`): one trait every adapter implements. v0's
//! skeleton (F-023) has the trait, the request and stream types, and the in-process scripted
//! provider ([`scripted`]); the HTTP adapters come with F-080 onwards.

pub mod scripted;

use std::future::Future;
use std::pin::Pin;

use serde::Serialize;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::Result;

/// A boxed future, so [`Provider`] stays usable as `dyn Provider` (the app picks one at run time).
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// One provider adapter.
pub trait Provider: Send + Sync {
    /// The provider's id, as settings and gloss attributes name it.
    fn id(&self) -> &str;

    /// Starts streaming the answer to `req`. The stream ends early, without an error, once
    /// `cancel` fires; dropping the [`EventStream`] stops it too.
    fn stream(&self, req: ChatRequest, cancel: CancellationToken) -> BoxFuture<'_, Result<EventStream>>;

    /// What `model` supports.
    fn capabilities(&self, model: &str) -> Caps;
}

/// What a model supports (`07-providers.md`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct Caps {
    /// Tool calls.
    pub tools: bool,
    /// Image input.
    pub vision: bool,
    /// The provider's own web search.
    pub native_search: bool,
    /// Prompt caching.
    pub caching: bool,
    /// JSON-schema output.
    pub structured_output: bool,
}

/// One request to a provider: the assembled prompt (`06-ai-harness.md#loop` step 1).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ChatRequest {
    /// The model id at the provider.
    pub model: String,
    /// The system prompt: Lecter's instructions and the role's.
    pub system: String,
    /// The conversation, oldest first.
    pub messages: Vec<Message>,
    /// The most tokens the answer may take.
    pub max_output_tokens: u32,
}

/// One message of a [`ChatRequest`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Message {
    /// Who said it.
    pub role: Role,
    /// What was said.
    pub content: String,
}

/// The speaker of a [`Message`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    /// The student, with Lecter's context.
    User,
    /// The model.
    Assistant,
}

/// One event of an answer's stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamEvent {
    /// More answer text.
    TextDelta(String),
    /// The provider finished the turn.
    Done,
}

/// How many events may wait between a provider and its reader. A text delta is a few words, so 64
/// is far more than one animation frame's worth, and a stalled reader holds the provider back
/// instead of growing memory.
pub const STREAM_BOUND: usize = 64;

/// The receiving end of a provider's stream (bounded: [`STREAM_BOUND`]).
#[derive(Debug)]
pub struct EventStream {
    rx: mpsc::Receiver<Result<StreamEvent>>,
}

/// The sending end a provider writes to.
pub type EventSender = mpsc::Sender<Result<StreamEvent>>;

impl EventStream {
    /// A new stream and the sender a provider writes to.
    pub fn channel() -> (EventSender, Self) {
        let (tx, rx) = mpsc::channel(STREAM_BOUND);
        (tx, Self { rx })
    }

    /// The next event; `None` once the provider has stopped (finished, failed or cancelled).
    pub async fn next(&mut self) -> Option<Result<StreamEvent>> {
        self.rx.recv().await
    }
}
