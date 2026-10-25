use super::*;
use crate::proto::FailCode;

/// Runs `serve` on the given core frames; returns its result and every frame the worker wrote.
fn exchange(core: &[ToWorker], pdfium_dir: &Path) -> (Result<(), Stop>, Vec<FromWorker>) {
    let mut input = Vec::new();
    for m in core {
        write_frame(&mut input, Codec::Json, m).unwrap();
    }
    let mut output = Vec::new();
    let result = serve(&mut input.as_slice(), &mut output, Codec::Json, pdfium_dir);
    let mut frames = Vec::new();
    let mut rest = output.as_slice();
    while let Some(f) = read_frame(&mut rest, Codec::Json).unwrap() {
        frames.push(f);
    }
    (result, frames)
}

fn hello() -> ToWorker {
    ToWorker::Hello { proto_version: PROTO_VERSION }
}

fn abs(p: &str) -> String {
    std::env::temp_dir().join(p).to_string_lossy().into_owned()
}

fn no_pdfium() -> PathBuf {
    std::env::temp_dir().join("lecter-parse-worker-no-pdfium")
}

#[test]
fn the_worker_says_hello_first_and_stops_on_a_version_mismatch() {
    let parse = ToWorker::Parse { path: abs("x.pdf"), limits: Limits::default() };
    let (r, frames) = exchange(&[ToWorker::Hello { proto_version: PROTO_VERSION + 1 }, parse], &no_pdfium());
    assert!(matches!(r, Err(Stop::Version { core }) if core == PROTO_VERSION + 1), "{r:?}");
    assert_eq!(frames, [FromWorker::Hello { proto_version: PROTO_VERSION }]);
}

#[test]
fn anything_but_hello_first_or_parse_second_is_refused() {
    let parse = ToWorker::Parse { path: abs("x.pdf"), limits: Limits::default() };
    let (r, _) = exchange(std::slice::from_ref(&parse), &no_pdfium());
    assert!(matches!(r, Err(Stop::Unexpected("Hello"))), "{r:?}");
    let (r, _) = exchange(&[hello(), hello()], &no_pdfium());
    assert!(matches!(r, Err(Stop::Unexpected("Parse"))), "{r:?}");
    let (r, _) = exchange(&[hello()], &no_pdfium());
    assert!(matches!(r, Err(Stop::Unexpected("Parse"))), "{r:?}");
    let (r, _) = exchange(&[], &no_pdfium());
    assert!(matches!(r, Err(Stop::Unexpected("Hello"))), "{r:?}");
}

#[test]
fn a_relative_file_path_fails_as_io_without_loading_pdfium() {
    let parse = ToWorker::Parse { path: "slides/x.pdf".into(), limits: Limits::default() };
    let (r, frames) = exchange(&[hello(), parse], &no_pdfium());
    assert!(r.is_ok(), "{r:?}");
    assert!(
        matches!(&frames[1], FromWorker::Failed { code: FailCode::Io, reason } if reason.contains("absolute")),
        "{frames:?}"
    );
    assert_eq!(frames.len(), 2);
}

#[test]
fn a_missing_pdfium_fails_as_engine() {
    let parse = ToWorker::Parse { path: abs("x.pdf"), limits: Limits::default() };
    let (r, frames) = exchange(&[hello(), parse], &no_pdfium());
    assert!(r.is_ok(), "{r:?}");
    assert!(matches!(&frames[1], FromWorker::Failed { code: FailCode::Engine, .. }), "{frames:?}");
}

#[test]
fn main_wants_exactly_the_pdfium_dir_flag() {
    for args in [vec![], vec!["--pdfium-dir"], vec!["--dir", "/x"], vec!["--pdfium-dir", "/x", "extra"]] {
        let code = main(args.iter().map(OsString::from));
        assert_eq!(code, ExitCode::from(EXIT_USAGE), "{args:?}");
    }
}
