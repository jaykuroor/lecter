//! The `ai` area (18-contracts.md#ipc): asking about a block of the open lecture and stopping the
//! answer. `gloss_request` assembles the request in `lecter_ai`, starts the stream and returns the
//! new gloss's id at once; the answer then arrives on the `GlossStream` channel, one delta per
//! event, and ends with the gloss's fenced div (03-lecture-files.md#body). The UI inserts that div
//! into the buffer, so it is saved like any other edit (`lecture_apply_edits`, journal, save).
//! `gloss_cancel` (`Esc`) stops a running stream.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use lecter_ai::ask::{ASK_TIME_BUDGET, Answer, End, stream_answer};
use lecter_ai::figures::sample::SampleProvider;
use lecter_ai::gloss::{GlossDiv, fenced_div, new_id, random_u32};
use lecter_ai::provider::Provider;
use lecter_ai::{CancellationToken, prompt};
use serde::Serialize;
use specta::Type;
use tauri::State;
use tauri::ipc::Channel;

use super::course::require_trusted_async;
use super::error::{ErrorCode, IpcError};
use super::lecture::check_course;
use super::session::{OpenLectures, OpenedCourses};
use super::validate::{self, IdKind, IpcLimits};

/// One event of a gloss's answer, in order: `started`, any number of `delta`s, then exactly one
/// of `done`, `stopped` or `failed`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum GlossStream {
    /// The stream began: the gloss's id and the model answering.
    Started { gloss: String, model: String },
    /// More answer text, to append.
    Delta { text: String },
    /// The answer is complete: the gloss's fenced div, to insert under its block.
    Done { markdown: String },
    /// Stopped by `Esc` or the time budget: the fenced div with the answer so far, or `null`
    /// when no text had arrived.
    Stopped { markdown: Option<String> },
    /// The provider failed; nothing is saved.
    Failed { error: IpcError },
}

/// The provider that answers and the streams running now, by gloss id. Cloning shares them.
#[derive(Clone)]
pub struct Glosses {
    provider: Arc<dyn Provider>,
    budget: Duration,
    running: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl Default for Glosses {
    /// Until a real provider can be connected (F-080 onwards), answers come from the offline
    /// sample provider, which says that it is a sample (and draws a sample plot when asked for one).
    fn default() -> Self {
        Self::new(Arc::new(SampleProvider), ASK_TIME_BUDGET)
    }
}

impl Glosses {
    /// Answers from `provider`, each stream stopped after `budget`.
    pub fn new(provider: Arc<dyn Provider>, budget: Duration) -> Self {
        Self { provider, budget, running: Arc::default() }
    }

    /// The id of the provider that answers (and so receives excerpts), for the trust screen.
    pub fn provider_id(&self) -> &str {
        self.provider.id()
    }

    fn running(&self) -> std::sync::MutexGuard<'_, HashMap<String, CancellationToken>> {
        self.running.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Stops every running stream (quitting).
    pub fn cancel_all(&self) {
        for token in self.running().values() {
            token.cancel();
        }
    }
}

/// Asks `question` about block `block` (`s3b2`) of the open lecture `path` of `course` and returns
/// the new gloss's id; the answer streams on `on_event`. A course not opened this session, a
/// lecture not open, a malformed block id, an empty question or one over 16 KB is
/// E_INVALID_ARGUMENT; a course that is read-only or not trusted is E_NOT_TRUSTED; a block the
/// lecture doesn't have is E_NOT_FOUND.
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments, reason = "Tauri injects three states besides the contract's five arguments")]
pub async fn gloss_request(
    courses: State<'_, OpenedCourses>,
    lectures: State<'_, OpenLectures>,
    glosses: State<'_, Glosses>,
    course: String,
    path: String,
    block: String,
    question: String,
    on_event: Channel<GlossStream>,
) -> Result<String, IpcError> {
    let ask = Ask { course, path, block, question };
    request(&courses, &lectures, &glosses, ask, move |event| on_event.send(event).is_ok()).await
}

/// Stops the stream of `gloss` (`Esc`). Its channel then gets `stopped`. A gloss that already
/// finished is no error; a malformed id is E_INVALID_ARGUMENT.
#[tauri::command]
#[specta::specta]
pub async fn gloss_cancel(glosses: State<'_, Glosses>, gloss: String) -> Result<(), IpcError> {
    cancel(&glosses, &gloss)
}

/// What `gloss_request` was asked.
struct Ask {
    course: String,
    path: String,
    block: String,
    question: String,
}

const REQUEST: &str = "gloss_request";

/// `gloss_request` without Tauri's wrappers; `send` delivers an event and says whether the UI is
/// still listening (a closed channel stops the stream).
async fn request(
    courses: &OpenedCourses,
    lectures: &OpenLectures,
    glosses: &Glosses,
    ask: Ask,
    send: impl Fn(GlossStream) -> bool + Send + Sync + 'static,
) -> Result<String, IpcError> {
    validate::id(REQUEST, "block", &ask.block, IdKind::Block)?;
    validate::string(REQUEST, "question", &ask.question, IpcLimits::default().prompt_bytes)?;
    check_course(courses, REQUEST, &ask.course)?;
    // SEC-27: no AI on a course that is read-only or not trusted as it is now.
    require_trusted_async(courses, &ask.course).await?;
    let text = lecture_text(lectures, &ask.course, &ask.path).await?;
    let model = lecter_ai::provider::scripted::SAMPLE_ID;
    let req = prompt::ask_request(&text, &ask.block, &ask.question, model).map_err(|e| match e {
        lecter_ai::Error::BlockNotFound => IpcError::new(ErrorCode::NotFound, e.to_string()),
        e => IpcError::new(ErrorCode::InvalidArgument, e.to_string()),
    })?;
    let id = {
        let mut running = glosses.running();
        // An id neither the lecture nor a running stream uses.
        let id = new_id(&text, || {
            loop {
                let n = random_u32();
                if !running.contains_key(&format!("g-{:04x}", n & 0xffff)) {
                    break n;
                }
            }
        });
        running.insert(id.clone(), CancellationToken::new());
        id
    };
    let cancel = glosses.running().get(&id).cloned().unwrap_or_default();
    let meta = Meta { id: id.clone(), anchor: ask.block, question: ask.question, model: model.to_owned() };
    let glosses = glosses.clone();
    tauri::async_runtime::spawn(async move {
        stream(glosses.provider.as_ref(), req, &meta, &cancel, glosses.budget, send).await;
        glosses.running().remove(&meta.id);
    });
    Ok(id)
}

/// The open lecture's text, as the buffer has it (journal edits included).
async fn lecture_text(lectures: &OpenLectures, course: &str, path: &str) -> Result<String, IpcError> {
    let (lectures, course, path) = (lectures.clone(), course.to_owned(), path.to_owned());
    tauri::async_runtime::spawn_blocking(move || {
        let Some(session) = lectures.get(&course, &path) else {
            tracing::warn!(target: "ipc", command = REQUEST, field = "path", "argument rejected: lecture not open");
            return Err(IpcError::new(ErrorCode::InvalidArgument, "Open the lecture before asking about it."));
        };
        session.text().map_err(super::course::ipc_error)
    })
    .await
    .map_err(|_| IpcError::new(ErrorCode::Internal, "Lecter could not read that lecture."))?
}

/// What the gloss's fenced div needs besides the answer.
struct Meta {
    id: String,
    anchor: String,
    question: String,
    model: String,
}

impl Meta {
    fn div(&self, answer: &str) -> String {
        fenced_div(&GlossDiv {
            id: &self.id,
            kind: "ask",
            key: "a",
            anchor: &self.anchor,
            model: &self.model,
            question: &self.question,
            answer,
        })
    }
}

/// Streams one answer to `send`: `started`, the deltas, then how it ended. A closed channel
/// cancels the stream. Logs sizes and outcomes only, never text.
async fn stream(
    provider: &dyn Provider,
    req: lecter_ai::provider::ChatRequest,
    meta: &Meta,
    cancel: &CancellationToken,
    budget: Duration,
    send: impl Fn(GlossStream) -> bool,
) {
    let deliver = |event: GlossStream| {
        if !send(event) {
            cancel.cancel();
        }
    };
    deliver(GlossStream::Started { gloss: meta.id.clone(), model: meta.model.clone() });
    let answer =
        stream_answer(provider, req, cancel, budget, |d| deliver(GlossStream::Delta { text: d.to_owned() })).await;
    let last = match answer {
        Ok(Answer { text, end: End::Finished }) => GlossStream::Done { markdown: meta.div(&text) },
        Ok(Answer { text, end: End::Cancelled | End::OutOfTime }) => {
            GlossStream::Stopped { markdown: (!text.trim().is_empty()).then(|| meta.div(&text)) }
        }
        Err(e) => GlossStream::Failed { error: IpcError::new(ErrorCode::Provider, e.to_string()) },
    };
    tracing::info!(target: "ipc", command = REQUEST, outcome = outcome(&last), "gloss stream ended");
    let _ = send(last);
}

fn outcome(event: &GlossStream) -> &'static str {
    match event {
        GlossStream::Done { .. } => "done",
        GlossStream::Stopped { .. } => "stopped",
        GlossStream::Failed { .. } => "failed",
        GlossStream::Started { .. } | GlossStream::Delta { .. } => "running",
    }
}

/// `gloss_cancel` without Tauri's wrappers.
fn cancel(glosses: &Glosses, gloss: &str) -> Result<(), IpcError> {
    validate::id("gloss_cancel", "gloss", gloss, IdKind::Gloss)?;
    if let Some(token) = glosses.running().get(gloss) {
        token.cancel();
    }
    Ok(())
}

#[cfg(test)]
mod tests;
