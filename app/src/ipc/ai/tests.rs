#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::path::Path;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use lecter_ai::provider::scripted::{ScriptedProvider, Step};
use lecter_core::course::trust::TrustChoice;
use lecter_core::save::Session;
use lecter_core::testenv::TestEnv;

use super::*;

const L07: &str = "lectures/l07.md";

/// A synthetic lecture as Lecter writes it (03-lecture-files.md#body). English only. It already
/// has a gloss `g-0001`.
const SEVEN: &str = "---\ntitle: Covariance\n---\n\n::: {.slide #s3 n=3 title=\"Properties\"}\n## Properties\n\n[Covariance is bilinear.]{#s3b1}\n\n[Var(X+Y) adds 2Cov(X,Y).]{#s3b2}\n\n::: {.gloss #g-0001 kind=ask key=a anchor=s3b2 model=\"sample\" by=ai}\n**you asked:** old\n:::\n:::\n";

/// Esc must stop the stream within this (F-023 criterion 4).
const CANCEL_LIMIT: Duration = Duration::from_millis(50);

/// A course with one lecture, remembered as opened, and that lecture's session open.
fn course(env: &TestEnv) -> (String, OpenedCourses, OpenLectures) {
    course_with(env, SEVEN)
}

/// [`course`] with the lecture's text `text`.
fn course_with(env: &TestEnv, text: &str) -> (String, OpenedCourses, OpenLectures) {
    let dir = env.home().join("STAT311");
    std::fs::create_dir_all(dir.join("lectures")).unwrap();
    std::fs::write(dir.join(L07), text).unwrap();
    let listing = lecter_core::course::open(&std::fs::canonicalize(&dir).unwrap()).unwrap();
    let courses = super::super::course::opened_for_test(env, &listing, Some(TrustChoice::Trusted));
    let lectures = OpenLectures::default();
    let path = listing.path.clone();
    lectures.get_or_open(&path, L07, || Session::open(Path::new(&path), L07).map(|(s, _)| s)).unwrap();
    (listing.path, courses, lectures)
}

fn step(ms: u64, text: &str) -> Step {
    Step { after: Duration::from_millis(ms), text: text.into() }
}

fn glosses(steps: Vec<Step>) -> Glosses {
    Glosses::new(Arc::new(ScriptedProvider::new("fake", steps)), Duration::from_secs(30))
}

fn ask(course: &str, block: &str, question: &str) -> Ask {
    Ask { course: course.into(), path: L07.into(), block: block.into(), question: question.into() }
}

/// Starts a request whose events go to the returned receiver.
fn start(
    courses: &OpenedCourses,
    lectures: &OpenLectures,
    g: &Glosses,
    a: Ask,
) -> (Result<String, IpcError>, mpsc::Receiver<GlossStream>) {
    let (tx, rx) = mpsc::channel();
    let id = tauri::async_runtime::block_on(request(courses, lectures, g, a, move |e| tx.send(e).is_ok()));
    (id, rx)
}

fn next(rx: &mpsc::Receiver<GlossStream>) -> GlossStream {
    rx.recv_timeout(Duration::from_secs(10)).unwrap_or_else(|e| panic!("no event: {e}"))
}

/// Every event up to and including the last one.
fn all(rx: &mpsc::Receiver<GlossStream>) -> Vec<GlossStream> {
    let mut out = Vec::new();
    loop {
        let e = next(rx);
        let last = matches!(e, GlossStream::Done { .. } | GlossStream::Stopped { .. } | GlossStream::Failed { .. });
        out.push(e);
        if last {
            return out;
        }
    }
}

/// F-023 criterion 1: the fake provider's answer arrives on the GlossStream channel in order, and
/// ends with the gloss's fenced div (criterion 3's format), under a new id the lecture lacks.
#[test]
fn a_request_streams_started_deltas_and_the_gloss_div() {
    let env = TestEnv::new().unwrap();
    let (path, courses, lectures) = course(&env);
    let g = glosses(vec![step(0, "Expand "), step(1, "the square.")]);
    let (id, rx) = start(&courses, &lectures, &g, ask(&path, "s3b2", "where does 2Cov come from?"));
    let id = id.unwrap_or_else(|e| panic!("{e:?}"));
    assert!(id.starts_with("g-") && id.len() == 6 && id != "g-0001", "{id}");
    let div = format!(
        "::: {{.gloss #{id} kind=ask key=Enter anchor=s3b2 model=\"sample\" by=ai}}\n**you asked:** where does 2Cov come from?\n\nExpand the square.\n:::"
    );
    assert_eq!(
        all(&rx),
        vec![
            GlossStream::Started { gloss: id.clone(), model: "sample".into() },
            GlossStream::Delta { text: "Expand ".into() },
            GlossStream::Delta { text: "the square.".into() },
            GlossStream::Done { markdown: div },
        ]
    );
}

/// F-048 criterion 2: asking about an own note (`n-91c0`) streams a gloss anchored to that note.
#[test]
fn a_request_on_a_note_streams_a_gloss_anchored_to_it() {
    let env = TestEnv::new().unwrap();
    let note = "\n:::\n\n::: {.note #n-91c0 anchor=s3b2}\nTry numbers.\n:::\n:::\n";
    let (path, courses, lectures) = course_with(&env, &SEVEN.replace("\n:::\n:::\n", note));
    let g = glosses(vec![step(0, "Pick X=1.")]);
    let (id, rx) = start(&courses, &lectures, &g, ask(&path, "n-91c0", "how?"));
    let id = id.unwrap_or_else(|e| panic!("{e:?}"));
    let div = format!(
        "::: {{.gloss #{id} kind=ask key=Enter anchor=n-91c0 model=\"sample\" by=ai}}\n**you asked:** how?\n\nPick X=1.\n:::"
    );
    assert_eq!(all(&rx).last(), Some(&GlossStream::Done { markdown: div }));
    // A note the lecture doesn't have is not found; a malformed note id is refused.
    let missing = refused(&courses, &lectures, ask(&path, "n-0bad", "how?"));
    assert_eq!(
        (missing.code, missing.message.as_str()),
        (ErrorCode::NotFound, "That line is no longer in the lecture.")
    );
    for bad in ["n-91c", "n-91C0", "n-91c0 ", "g-0001", "n-"] {
        assert_eq!(refused(&courses, &lectures, ask(&path, bad, "how?")).code, ErrorCode::InvalidArgument, "{bad}");
    }
}

/// F-023 criterion 4: `gloss_cancel` stops a slow stream within 50 ms; the answer so far comes back
/// as the gloss to save.
#[test]
fn cancel_stops_a_slow_stream_within_50_ms() {
    let env = TestEnv::new().unwrap();
    let (path, courses, lectures) = course(&env);
    let g = glosses(vec![step(0, "first "), step(10_000, "never")]);
    let (id, rx) = start(&courses, &lectures, &g, ask(&path, "s3b1", "why?"));
    let id = id.unwrap_or_else(|e| panic!("{e:?}"));
    assert!(matches!(next(&rx), GlossStream::Started { .. }));
    assert_eq!(next(&rx), GlossStream::Delta { text: "first ".into() });
    let t = Instant::now();
    cancel(&g, &id).unwrap_or_else(|e| panic!("{e:?}"));
    let last = next(&rx);
    let took = t.elapsed();
    assert!(took < CANCEL_LIMIT, "Esc took {took:?}");
    let div = format!(
        "::: {{.gloss #{id} kind=ask key=Enter anchor=s3b1 model=\"sample\" by=ai}}\n**you asked:** why?\n\nfirst\n:::"
    );
    assert_eq!(last, GlossStream::Stopped { markdown: Some(div) });
    // The stream is gone, so cancelling again is a no-op.
    let deadline = Instant::now() + Duration::from_secs(5);
    while g.running().contains_key(&id) && Instant::now() < deadline {
        std::thread::yield_now();
    }
    assert!(!g.running().contains_key(&id));
    assert_eq!(cancel(&g, &id), Ok(()));
}

#[test]
fn a_stream_stopped_before_any_text_saves_nothing() {
    let env = TestEnv::new().unwrap();
    let (path, courses, lectures) = course(&env);
    let g = glosses(vec![step(10_000, "late")]);
    let (id, rx) = start(&courses, &lectures, &g, ask(&path, "s3b1", "why?"));
    let id = id.unwrap_or_else(|e| panic!("{e:?}"));
    assert!(matches!(next(&rx), GlossStream::Started { .. }));
    g.cancel_all();
    assert_eq!(next(&rx), GlossStream::Stopped { markdown: None });
    assert_eq!(cancel(&g, &id), Ok(()));
}

#[test]
fn a_closed_channel_stops_the_stream() {
    let env = TestEnv::new().unwrap();
    let (path, courses, lectures) = course(&env);
    let g = glosses(vec![step(0, "a"), step(10_000, "b")]);
    let id = tauri::async_runtime::block_on(request(&courses, &lectures, &g, ask(&path, "s3b1", "why?"), |_| false));
    let id = id.unwrap_or_else(|e| panic!("{e:?}"));
    let deadline = Instant::now() + Duration::from_secs(2);
    while g.running().contains_key(&id) && Instant::now() < deadline {
        std::thread::yield_now();
    }
    assert!(!g.running().contains_key(&id), "the stream kept running for a closed channel");
}

fn refused(courses: &OpenedCourses, lectures: &OpenLectures, a: Ask) -> IpcError {
    let g = glosses(vec![step(0, "x")]);
    let (got, _rx) = start(courses, lectures, &g, a);
    let e = got.err().unwrap_or_else(|| panic!("accepted"));
    assert!(g.running().is_empty(), "a refused request started a stream");
    e
}

/// SEC-32: every argument is checked before a stream starts.
#[test]
fn bad_requests_are_refused_with_their_codes() {
    let env = TestEnv::new().unwrap();
    let (path, courses, lectures) = course(&env);
    let code = |a: Ask| refused(&courses, &lectures, a).code;
    assert_eq!(code(ask(&path, "s3", "why?")), ErrorCode::InvalidArgument);
    assert_eq!(code(ask(&path, "s3b1 ", "why?")), ErrorCode::InvalidArgument);
    assert_eq!(code(ask(&path, "s3b1", " \n ")), ErrorCode::InvalidArgument);
    assert_eq!(code(ask(&path, "s3b1", &"x".repeat(16 * 1024 + 1))), ErrorCode::InvalidArgument);
    assert_eq!(code(ask(&format!("{path}-other"), "s3b1", "why?")), ErrorCode::InvalidArgument);
    assert_eq!(code(Ask { path: "lectures/l08.md".into(), ..ask(&path, "s3b1", "why?") }), ErrorCode::InvalidArgument);
    let missing = refused(&courses, &lectures, ask(&path, "s3b9", "why?"));
    assert_eq!(
        (missing.code, missing.message.as_str()),
        (ErrorCode::NotFound, "That line is no longer in the lecture.")
    );
}

/// F-033 criteria 2 and 6 (SEC-27): a course opened read-only, or not answered yet, gets no AI:
/// the request is E_NOT_TRUSTED from the core and no stream starts. Trusting it lets it ask.
#[test]
fn a_read_only_or_unanswered_course_gets_no_ai() {
    let env = TestEnv::new().unwrap();
    let (path, _, lectures) = course(&env);
    let listing = lecter_core::course::open(Path::new(&path)).unwrap();
    // `course` trusted it; forgetting every answer leaves the question open.
    std::fs::remove_file(env.dirs().config().join("trusted.jsonc")).unwrap();
    for choice in [None, Some(TrustChoice::ReadOnly)] {
        let courses = super::super::course::opened_for_test(&env, &listing, choice);
        let e = refused(&courses, &lectures, ask(&path, "s3b1", "why?"));
        assert_eq!(e.code, ErrorCode::NotTrusted, "{choice:?}: {e:?}");
    }
    let courses = super::super::course::opened_for_test(&env, &listing, Some(TrustChoice::Trusted));
    let g = glosses(vec![step(0, "x")]);
    let (id, rx) = start(&courses, &lectures, &g, ask(&path, "s3b1", "why?"));
    assert!(id.is_ok(), "{id:?}");
    assert!(matches!(all(&rx).last(), Some(GlossStream::Done { .. })));
}

#[test]
fn a_question_of_exactly_16_kb_is_accepted() {
    let env = TestEnv::new().unwrap();
    let (path, courses, lectures) = course(&env);
    let g = glosses(vec![step(0, "x")]);
    let (id, rx) = start(&courses, &lectures, &g, ask(&path, "s3b1", &"x".repeat(16 * 1024)));
    assert!(id.is_ok(), "{id:?}");
    assert!(matches!(all(&rx).last(), Some(GlossStream::Done { .. })));
}

#[test]
fn cancel_checks_the_gloss_id() {
    let g = glosses(vec![]);
    for bad in ["", "g-1", "g-xyz0", "n-0001", "g-0001 "] {
        assert_eq!(cancel(&g, bad).map_err(|e| e.code), Err(ErrorCode::InvalidArgument), "{bad:?}");
    }
    assert_eq!(cancel(&g, "g-abcd"), Ok(()));
}

/// The channel's wire shape, as the UI reads it.
#[test]
fn gloss_stream_events_are_tagged_by_name() {
    let json = |e: &GlossStream| serde_json::to_value(e).unwrap();
    assert_eq!(
        json(&GlossStream::Delta { text: "x".into() }),
        serde_json::json!({ "event": "delta", "data": { "text": "x" } })
    );
    assert_eq!(
        json(&GlossStream::Started { gloss: "g-0002".into(), model: "sample".into() }),
        serde_json::json!({ "event": "started", "data": { "gloss": "g-0002", "model": "sample" } })
    );
    assert_eq!(
        json(&GlossStream::Stopped { markdown: None }),
        serde_json::json!({ "event": "stopped", "data": { "markdown": null } })
    );
}

/// The contract: `gloss_request(course, path, block, question, onEvent)` and `gloss_cancel(gloss)`.
#[test]
fn gloss_commands_take_their_arguments_in_order() {
    let contract = super::super::contract();
    let args = crate::export::command_args(&contract, "gloss_request");
    let want = ["course", "path", "block", "question", "on_event"].map(String::from).to_vec();
    assert_eq!(args, Some(want));
    assert_eq!(crate::export::command_args(&contract, "gloss_cancel"), Some(vec!["gloss".to_owned()]));
}
