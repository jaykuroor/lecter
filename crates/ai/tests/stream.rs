//! F-023 criteria 1 and 4: the fake (scripted) provider streams an answer through the `Provider`
//! trait and the answer loop, and cancelling (`Esc`) stops a slow stream within 50 ms.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use lecter_ai::ask::{End, stream_answer};
use lecter_ai::provider::scripted::{ScriptedProvider, Step};
use lecter_ai::provider::{BoxFuture, Caps, ChatRequest, EventStream, Provider, StreamEvent};
use lecter_ai::{CancellationToken, Error};

/// Esc must stop the stream within this (criterion 4).
const CANCEL_LIMIT: Duration = Duration::from_millis(50);

fn req() -> ChatRequest {
    ChatRequest { model: "fake".into(), system: "s".into(), messages: vec![], max_output_tokens: 16 }
}

fn step(ms: u64, text: &str) -> Step {
    Step { after: Duration::from_millis(ms), text: text.into() }
}

/// A provider whose second delta comes only after 10 s: a slow stream.
fn slow() -> ScriptedProvider {
    ScriptedProvider::new("fake", vec![step(0, "first "), step(10_000, "never")])
}

#[tokio::test]
async fn the_fake_provider_streams_every_delta_in_order_then_finishes() {
    let provider = ScriptedProvider::new("fake", vec![step(0, "Expand "), step(5, "the "), step(0, "square.")]);
    let mut seen = Vec::new();
    let answer = stream_answer(&provider, req(), &CancellationToken::new(), Duration::from_secs(5), |d| {
        seen.push(d.to_owned());
    })
    .await
    .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(seen, ["Expand ", "the ", "square."]);
    assert_eq!(answer.text, "Expand the square.");
    assert_eq!(answer.end, End::Finished);
}

#[tokio::test]
async fn the_provider_trait_hands_out_a_stream_that_ends_with_done() {
    let provider: Arc<dyn Provider> = Arc::new(ScriptedProvider::new("fake", vec![step(0, "a"), step(0, "b")]));
    assert_eq!(provider.id(), "fake");
    assert_eq!(provider.capabilities("fake"), Caps::default());
    let mut stream = provider.stream(req(), CancellationToken::new()).await.unwrap_or_else(|e| panic!("{e}"));
    let mut events = Vec::new();
    while let Some(e) = stream.next().await {
        events.push(e.unwrap_or_else(|e| panic!("{e}")));
    }
    assert_eq!(events, [StreamEvent::TextDelta("a".into()), StreamEvent::TextDelta("b".into()), StreamEvent::Done]);
}

#[tokio::test]
async fn cancelling_a_slow_stream_returns_within_50_ms_with_the_text_so_far() {
    let provider = slow();
    let cancel = CancellationToken::new();
    let cancelled_at = Arc::new(Mutex::new(None::<Instant>));
    let (c, at) = (cancel.clone(), Arc::clone(&cancelled_at));
    // Esc arrives once the first word is on screen.
    let answer = stream_answer(&provider, req(), &cancel, Duration::from_secs(30), move |_| {
        *at.lock().unwrap_or_else(|e| panic!("{e}")) = Some(Instant::now());
        c.cancel();
    })
    .await
    .unwrap_or_else(|e| panic!("{e}"));
    let took = cancelled_at.lock().unwrap_or_else(|e| panic!("{e}")).map(|t| t.elapsed());
    let took = took.unwrap_or_else(|| panic!("never cancelled"));
    assert!(took < CANCEL_LIMIT, "Esc took {took:?}");
    assert_eq!(answer.text, "first ");
    assert_eq!(answer.end, End::Cancelled);
}

#[tokio::test]
async fn a_cancelled_provider_stops_its_own_stream_within_50_ms() {
    let cancel = CancellationToken::new();
    let mut stream = slow().stream(req(), cancel.clone()).await.unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(stream.next().await.map(|e| e.ok()), Some(Some(StreamEvent::TextDelta("first ".into()))));
    let t = Instant::now();
    cancel.cancel();
    let next = tokio::time::timeout(Duration::from_secs(5), stream.next()).await;
    assert!(matches!(next, Ok(None)), "the provider kept streaming: {next:?}");
    assert!(t.elapsed() < CANCEL_LIMIT, "the provider stopped after {:?}", t.elapsed());
}

#[tokio::test]
async fn cancelling_before_the_stream_starts_answers_nothing() {
    let cancel = CancellationToken::new();
    cancel.cancel();
    let mut calls = 0;
    let answer = stream_answer(&slow(), req(), &cancel, Duration::from_secs(30), |_| calls += 1)
        .await
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!((answer.text.as_str(), answer.end, calls), ("", End::Cancelled, 0));
}

#[tokio::test]
async fn the_time_budget_stops_a_stream_that_runs_too_long() {
    let t = Instant::now();
    let answer = stream_answer(&slow(), req(), &CancellationToken::new(), Duration::from_millis(100), |_| {})
        .await
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!((answer.text.as_str(), answer.end), ("first ", End::OutOfTime));
    assert!(t.elapsed() < Duration::from_secs(5), "{:?}", t.elapsed());
}

/// A provider that breaks off: one delta, then its stream closes without `Done`.
struct BreaksOff;

impl Provider for BreaksOff {
    fn id(&self) -> &str {
        "breaks-off"
    }

    fn stream(&self, _req: ChatRequest, _cancel: CancellationToken) -> BoxFuture<'_, lecter_ai::Result<EventStream>> {
        Box::pin(async {
            let (tx, stream) = EventStream::channel();
            tx.send(Ok(StreamEvent::TextDelta("half".into()))).await.unwrap_or_else(|e| panic!("{e}"));
            Ok(stream)
        })
    }

    fn capabilities(&self, _model: &str) -> Caps {
        Caps::default()
    }
}

#[tokio::test]
async fn a_stream_that_breaks_off_is_a_provider_error() {
    let mut seen = String::new();
    let got =
        stream_answer(&BreaksOff, req(), &CancellationToken::new(), Duration::from_secs(5), |d| seen.push_str(d)).await;
    assert_eq!(got, Err(Error::Provider("the stream ended before the answer did".into())));
    assert_eq!(seen, "half");
}
