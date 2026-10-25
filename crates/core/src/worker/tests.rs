//! The core's side of the worker protocol against fake workers: small Python programs that speak
//! the debug (JSON) frames and then misbehave on purpose. They are the "crashing fixture" of F-019
//! criterion 3; `crates/parse/tests/worker_process.rs` covers the real worker's side.

use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use lecter_parse::proto::PROTO_VERSION;

use super::*;
use crate::error::Error;
use crate::error_code::ErrorCode;

/// A fake worker. `argv[1]` is the mode, `argv[2]` the protocol version it claims.
const FAKE: &str = r#"
import json, os, struct, sys, time
mode, version = sys.argv[1], int(sys.argv[2])
out, inp = sys.stdout.buffer, sys.stdin.buffer
def send(msg):
    body = json.dumps(msg).encode()
    out.write(struct.pack("<I", len(body)) + body)
    out.flush()
def recv():
    head = inp.read(4)
    return json.loads(inp.read(struct.unpack("<I", head)[0]))
if mode == "crash-at-start":
    os.abort()
if mode == "no-hello":
    send({"Progress": {"page": 1, "pages": 1}})
    time.sleep(3600)
send({"Hello": {"proto_version": version}})
assert recv() == {"Hello": {"proto_version": version}}
job = recv()["Parse"]
if mode == "exit-7":
    sys.exit(7)
if mode == "exit-0":
    sys.exit(0)
if mode == "crash":
    send({"Progress": {"page": 1, "pages": 3}})
    os.abort()
if mode == "hang":
    send({"Progress": {"page": 1, "pages": 3}})
    time.sleep(3600)
if mode == "garbage":
    out.write(b"\xff\xff\xff\xff")
    out.flush()
    time.sleep(3600)
if mode == "failed":
    send({"Failed": {"code": "limit", "reason": "the file has 9 pages, over the 2-page limit (limits.pages)"}})
if mode == "done":
    send({"Progress": {"page": 1, "pages": 2}})
    send({"Progress": {"page": 2, "pages": 2}})
    block = {"id": "s1b1", "page": 1, "kind": "paragraph", "text": job["path"] + " pages<=" + str(job["limits"]["pages"]),
             "bbox": {"x": 1.0, "y": 2.0, "w": 3.0, "h": 4.0}, "method": "text_layer", "confidence": 1.0}
    send({"Done": {"blocks": [block], "crops": [], "figures": []}})
"#;

/// The first launcher that really runs Python 3 (`python3`, `python`, `py`: the Windows Store
/// stub starts but isn't Python, so each is probed).
fn python() -> &'static str {
    static FOUND: OnceLock<&'static str> = OnceLock::new();
    FOUND.get_or_init(|| {
        ["python3", "python", "py"]
            .into_iter()
            .find(|p| {
                StdCommand::new(p)
                    .args(["-I", "-c", "import sys; print(sys.version_info[0])"])
                    .output()
                    .is_ok_and(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "3")
            })
            .unwrap_or_else(|| panic!("the worker tests need Python 3 (scripts/init.sh checks for it)"))
    })
}

fn fake(mode: &str, version: u32) -> WorkerCommand {
    WorkerCommand {
        program: PathBuf::from(python()),
        args: vec!["-I".into(), "-c".into(), FAKE.into(), mode.into(), version.to_string().into()],
        codec: Codec::Json,
    }
}

fn file() -> PathBuf {
    std::env::temp_dir().join("slides").join("l01.pdf")
}

async fn run(mode: &str, timeout: Duration) -> (crate::Result<Parsed>, Vec<(u32, u32)>) {
    let mut seen = Vec::new();
    let r = parse_file(&fake(mode, PROTO_VERSION), &file(), Limits::default(), timeout, |p, n| seen.push((p, n))).await;
    (r, seen)
}

fn parse_failed(r: crate::Result<Parsed>) -> String {
    match r {
        Err(e @ Error::ParseFailed(_)) => {
            assert_eq!(e.code(), ErrorCode::ParseFailed);
            e.to_string()
        }
        other => panic!("expected E_PARSE_FAILED, got {other:?}"),
    }
}

#[test]
fn the_worker_time_limit_is_sixty_seconds() {
    assert_eq!(PARSE_TIMEOUT, Duration::from_secs(60));
}

#[test]
fn the_parse_worker_command_names_the_pdfium_folder() {
    let c = WorkerCommand::parse_worker("/app/lecter-parse".into(), "/app/res".into());
    assert_eq!(c.program, Path::new("/app/lecter-parse"));
    assert_eq!(c.args, ["--pdfium-dir", "/app/res"]);
    assert_eq!(c.codec, Codec::BUILD);
}

#[tokio::test]
async fn worker_done_returns_the_blocks_and_relays_progress() {
    let (r, seen) = run("done", PARSE_TIMEOUT).await;
    let parsed = r.unwrap();
    assert_eq!(seen, [(1, 2), (2, 2)]);
    assert_eq!(parsed.blocks.len(), 1);
    // The fake echoes the path and page limit it was sent.
    assert_eq!(parsed.blocks[0].text, format!("{} pages<=2000", file().display()));
    assert_eq!(parsed.blocks[0].bbox, BBox { x: 1.0, y: 2.0, w: 3.0, h: 4.0 });
    assert!(parsed.crops.is_empty() && parsed.figures.is_empty());
}

#[tokio::test]
async fn worker_crash_mid_parse_is_parse_failed() {
    let (r, seen) = run("crash", PARSE_TIMEOUT).await;
    let msg = parse_failed(r);
    // Python's abort() is SIGABRT on Unix and exit code 3 on Windows.
    let how = if cfg!(unix) { "it crashed" } else { "exit code 3" };
    assert_eq!(msg, format!("The parse worker stopped unexpectedly (its output ended; {how})."));
    assert_eq!(seen, [(1, 3)]);
}

#[tokio::test]
async fn worker_exiting_without_an_answer_is_parse_failed_with_its_status() {
    let msg = parse_failed(run("exit-7", PARSE_TIMEOUT).await.0);
    assert_eq!(msg, "The parse worker stopped unexpectedly (its output ended; exit code 7).");
    let msg = parse_failed(run("exit-0", PARSE_TIMEOUT).await.0);
    assert_eq!(msg, "The parse worker stopped unexpectedly (its output ended; it exited without an error).");
}

#[tokio::test]
async fn worker_crash_before_hello_is_parse_failed() {
    let msg = parse_failed(run("crash-at-start", PARSE_TIMEOUT).await.0);
    assert!(msg.contains("its output ended"), "{msg}");
}

#[tokio::test(flavor = "current_thread")]
async fn worker_past_its_time_limit_is_killed_and_the_core_stays_responsive() {
    let ticks = AtomicU32::new(0);
    let ticker = async {
        loop {
            tokio::time::sleep(Duration::from_millis(10)).await;
            ticks.fetch_add(1, Ordering::Relaxed);
        }
    };
    let start = Instant::now();
    let r = tokio::select! {
        r = run("hang", Duration::from_millis(1500)) => r,
        () = ticker => unreachable!("the ticker never ends"),
    };
    let elapsed = start.elapsed();
    let msg = parse_failed(r.0);
    assert_eq!(msg, "Parsing took longer than 1.5 s, so the parse worker was stopped.");
    assert_eq!(r.1, [(1, 3)]);
    assert!(elapsed >= Duration::from_millis(1500) && elapsed < Duration::from_secs(10), "{elapsed:?}");
    // On one thread, the ticker only advanced because waiting on the worker never blocked it.
    assert!(ticks.load(Ordering::Relaxed) >= 50, "{} ticks in {elapsed:?}", ticks.load(Ordering::Relaxed));
}

#[tokio::test]
async fn worker_with_another_protocol_version_is_refused() {
    let mut seen = 0;
    let cmd = fake("done", PROTO_VERSION + 1);
    let r = parse_file(&cmd, &file(), Limits::default(), PARSE_TIMEOUT, |_, _| seen += 1).await;
    let msg = parse_failed(r);
    assert!(
        msg.contains(&format!("protocol version mismatch: worker {}, core {PROTO_VERSION}", PROTO_VERSION + 1)),
        "{msg}"
    );
    assert_eq!(seen, 0);
}

#[tokio::test]
async fn worker_that_skips_hello_is_refused_and_killed() {
    let start = Instant::now();
    let (r, seen) = run("no-hello", PARSE_TIMEOUT).await;
    let msg = parse_failed(r);
    assert!(msg.contains("its first frame was not Hello"), "{msg}");
    assert!(seen.is_empty(), "progress relayed before Hello: {seen:?}");
    assert!(start.elapsed() < Duration::from_secs(10), "waited on a hanging worker");
}

#[tokio::test]
async fn worker_sending_an_oversized_frame_is_killed() {
    let start = Instant::now();
    let msg = parse_failed(run("garbage", PARSE_TIMEOUT).await.0);
    assert!(msg.contains("over the"), "{msg}");
    assert!(start.elapsed() < Duration::from_secs(10), "waited on a hanging worker");
}

#[tokio::test]
async fn worker_failed_reason_reaches_the_user_as_is() {
    let msg = parse_failed(run("failed", PARSE_TIMEOUT).await.0);
    assert_eq!(msg, "the file has 9 pages, over the 2-page limit (limits.pages)");
}

#[tokio::test]
async fn worker_that_cannot_start_is_parse_failed() {
    let cmd = WorkerCommand::parse_worker(std::env::temp_dir().join("no-such-lecter-parse"), "/x".into());
    let msg = parse_failed(parse_file(&cmd, &file(), Limits::default(), PARSE_TIMEOUT, |_, _| {}).await);
    assert!(msg.starts_with("The parse worker could not be started"), "{msg}");
}

#[tokio::test]
async fn worker_is_never_started_for_a_relative_path() {
    let cmd = fake("done", PROTO_VERSION);
    let r = parse_file(&cmd, Path::new("slides/l01.pdf"), Limits::default(), PARSE_TIMEOUT, |_, _| {}).await;
    assert_eq!(r.unwrap_err(), Error::NotAbsolute);
}
