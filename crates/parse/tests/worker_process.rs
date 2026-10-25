//! Criterion 1: `lecter-parse` runs as a child process speaking the worker protocol
//! (`18-contracts.md#worker-protocol`), with a Hello version check.

mod common;

use std::io::Write;
use std::process::{Child, Command, Stdio};

use common::{TWO_PAGES, fixture, pdfium_dir};
use lecter_parse::proto::{Codec, FailCode, FromWorker, Limits, PROTO_VERSION, ToWorker, read_frame, write_frame};
use lecter_parse::worker::{EXIT_PROTOCOL, EXIT_USAGE, PDFIUM_DIR_FLAG};

fn spawn() -> Child {
    Command::new(env!("CARGO_BIN_EXE_lecter-parse"))
        .arg(PDFIUM_DIR_FLAG)
        .arg(pdfium_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap()
}

/// Sends `frames`, closes stdin, and returns every frame the worker wrote, its exit code and stderr.
fn talk(frames: &[ToWorker]) -> (Vec<FromWorker>, Option<i32>, String) {
    let mut child = spawn();
    let mut stdin = child.stdin.take().unwrap();
    for f in frames {
        write_frame(&mut stdin, Codec::BUILD, f).unwrap();
    }
    drop(stdin);
    let out = child.wait_with_output().unwrap();
    let mut got = Vec::new();
    let mut rest = out.stdout.as_slice();
    while let Some(f) = read_frame(&mut rest, Codec::BUILD).unwrap() {
        got.push(f);
    }
    (got, out.status.code(), String::from_utf8_lossy(&out.stderr).into_owned())
}

fn parse(path: std::path::PathBuf) -> ToWorker {
    ToWorker::Parse { path: path.to_string_lossy().into_owned(), limits: Limits::default() }
}

#[test]
fn the_worker_process_parses_the_fixture_over_the_protocol() {
    let hello = ToWorker::Hello { proto_version: PROTO_VERSION };
    let (frames, code, stderr) = talk(&[hello, parse(fixture("text-two-pages.pdf"))]);
    assert_eq!(code, Some(0), "{stderr}");
    assert_eq!(frames[0], FromWorker::Hello { proto_version: PROTO_VERSION });
    assert_eq!(frames[1..3], [FromWorker::Progress { page: 1, pages: 2 }, FromWorker::Progress { page: 2, pages: 2 }]);
    let FromWorker::Done { blocks, crops, figures } = &frames[3] else { panic!("{:?}", frames[3]) };
    let got: Vec<(&str, u32, &str)> = blocks.iter().map(|b| (b.id.as_str(), b.page, b.text.as_str())).collect();
    assert_eq!(got, TWO_PAGES);
    assert!(crops.is_empty() && figures.is_empty());
    assert_eq!(frames.len(), 4);
}

#[test]
fn a_core_with_another_protocol_version_gets_hello_and_nothing_else() {
    let hello = ToWorker::Hello { proto_version: PROTO_VERSION + 1 };
    let (frames, code, stderr) = talk(&[hello, parse(fixture("text-two-pages.pdf"))]);
    assert_eq!(frames, [FromWorker::Hello { proto_version: PROTO_VERSION }]);
    assert_eq!(code, Some(i32::from(EXIT_PROTOCOL)));
    assert!(stderr.contains("protocol version mismatch"), "{stderr}");
}

#[test]
fn an_unreadable_file_is_answered_with_failed_not_a_crash() {
    let dir = std::env::temp_dir().join(format!("lecter-parse-worker-process-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let junk = dir.join("junk.pdf");
    std::fs::write(&junk, b"%PDF-1.4\nbroken").unwrap();
    let hello = ToWorker::Hello { proto_version: PROTO_VERSION };
    let (frames, code, stderr) = talk(&[hello, parse(junk)]);
    std::fs::remove_dir_all(&dir).unwrap();
    assert_eq!(code, Some(0), "{stderr}");
    assert!(matches!(&frames[1], FromWorker::Failed { code: FailCode::Unreadable, .. }), "{frames:?}");
}

#[test]
fn the_worker_refuses_a_bad_command_line() {
    let out = Command::new(env!("CARGO_BIN_EXE_lecter-parse")).arg("--nope").stdin(Stdio::null()).output().unwrap();
    assert_eq!(out.status.code(), Some(i32::from(EXIT_USAGE)));
    assert!(out.stdout.is_empty());
}

#[test]
fn a_frame_cut_short_stops_the_worker_with_an_error() {
    let mut child = spawn();
    let mut stdin = child.stdin.take().unwrap();
    stdin.write_all(&[10, 0, 0, 0, b'{']).unwrap();
    drop(stdin);
    let out = child.wait_with_output().unwrap();
    assert_eq!(out.status.code(), Some(i32::from(EXIT_PROTOCOL)));
    assert!(String::from_utf8_lossy(&out.stderr).contains("middle of a frame"));
}
