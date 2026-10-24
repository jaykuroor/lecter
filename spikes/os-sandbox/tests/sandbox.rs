//! F-005 criteria 1 and 2: once sandboxed, the child cannot open a network socket, read a file other
//! than its input, or exceed 1 GiB. Every denial is paired with an unsandboxed control run of the same
//! probe, so a probe that fails for an unrelated reason can't pass as "sandboxed".
#![allow(clippy::disallowed_methods, reason = "test setup: temp files and a loopback listener")]
#![allow(clippy::unwrap_used, reason = "test helpers: a failed setup step should panic the test")]

use std::ffi::OsStr;
use std::net::TcpListener;
use std::path::{Path, PathBuf};

use lecter_spike_os_sandbox::probe::{DENIED, OK};
use lecter_spike_os_sandbox::{MEMORY_LIMIT_BYTES, Outcome, run_sandboxed, run_unsandboxed};

const PROBE: &str = env!("CARGO_BIN_EXE_sandbox-probe");

/// A temp folder with the child's input and a sibling secret (synthetic text only).
struct Fixture {
    dir: PathBuf,
    input: PathBuf,
    secret: PathBuf,
}

impl Fixture {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("lecter-f005-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let input = dir.join("input.txt");
        let secret = dir.join("secret.txt");
        std::fs::write(&input, "synthetic lecture input").unwrap();
        std::fs::write(&secret, "synthetic secret").unwrap();
        Self { dir, input, secret }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn probe() -> &'static Path {
    Path::new(PROBE)
}

fn sandboxed(f: &Fixture, args: &[&str]) -> Outcome {
    let args: Vec<&OsStr> = args.iter().map(OsStr::new).collect();
    let out = run_sandboxed(probe(), &f.input, &args).unwrap();
    eprintln!("sandboxed   {args:?} -> {:?} {}", out.code, out.stderr.trim().replace('\n', " | "));
    out
}

fn unsandboxed(args: &[&str]) -> Outcome {
    let args: Vec<&OsStr> = args.iter().map(OsStr::new).collect();
    let out = run_unsandboxed(probe(), &args).unwrap();
    eprintln!("unsandboxed {args:?} -> {:?} {}", out.code, out.stderr.trim().replace('\n', " | "));
    out
}

fn path(p: &Path) -> &str {
    p.to_str().unwrap()
}

#[test]
fn sandboxed_child_can_read_its_input() {
    let f = Fixture::new("input");
    let out = sandboxed(&f, &["read", path(&f.input)]);
    assert_eq!(out.code, Some(OK), "{out:?}");
}

#[test]
fn sandboxed_child_cannot_read_a_sibling_file() {
    let f = Fixture::new("sibling");
    let control = unsandboxed(&["read", path(&f.secret)]);
    assert_eq!(control.code, Some(OK), "control: {control:?}");
    let out = sandboxed(&f, &["read", path(&f.secret)]);
    assert_eq!(out.code, Some(DENIED), "{out:?}");
}

#[test]
fn sandboxed_child_cannot_read_a_file_in_another_folder() {
    let f = Fixture::new("other");
    let other = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
    let control = unsandboxed(&["read", path(&other)]);
    assert_eq!(control.code, Some(OK), "control: {control:?}");
    let out = sandboxed(&f, &["read", path(&other)]);
    assert_eq!(out.code, Some(DENIED), "{out:?}");
}

#[test]
fn sandboxed_child_cannot_open_a_network_socket() {
    let f = Fixture::new("net");
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap().to_string();
    let control = unsandboxed(&["net", &addr]);
    assert_eq!(control.code, Some(OK), "control: {control:?}");
    let out = sandboxed(&f, &["net", &addr]);
    assert_eq!(out.code, Some(DENIED), "{out:?}");
}

#[test]
fn sandboxed_child_cannot_exceed_1_gib() {
    let f = Fixture::new("mem-over");
    let over = format!("{}", (MEMORY_LIMIT_BYTES >> 20) + 64);
    let control = unsandboxed(&["alloc", &over]);
    assert_eq!(control.code, Some(OK), "control: {control:?}");
    let out = sandboxed(&f, &["alloc", &over]);
    assert_eq!(out.code, Some(DENIED), "{out:?}");
}

#[test]
fn sandboxed_child_can_allocate_well_under_the_limit() {
    let f = Fixture::new("mem-under");
    let out = sandboxed(&f, &["alloc", "256"]);
    assert_eq!(out.code, Some(OK), "{out:?}");
}
