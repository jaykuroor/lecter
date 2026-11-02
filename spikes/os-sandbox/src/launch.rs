//! Parent side: run the child with or without the sandbox and collect its exit code.

use std::ffi::OsStr;
use std::path::Path;
use std::process::{Command, Stdio};

use crate::Error;
use crate::probe::SANDBOX_FLAG;

/// How a child run ended.
#[derive(Debug)]
pub struct Outcome {
    /// Exit code, or `None` if a signal ended it.
    pub code: Option<i32>,
    /// What the child wrote to stderr (on Windows through a pipe passed in the handle list).
    pub stderr: String,
}

/// Runs `exe <args>` with no sandbox (the control case).
pub fn run_unsandboxed(exe: &Path, args: &[&OsStr]) -> Result<Outcome, Error> {
    let out = Command::new(exe)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .output()
        .map_err(|e| Error::new("spawn", e))?;
    Ok(Outcome { code: out.status.code(), stderr: String::from_utf8_lossy(&out.stderr).into_owned() })
}

/// Runs `exe --sandbox <input> <args>` sandboxed so that it can read only `input`.
///
/// On Linux and macOS the child applies the sandbox itself ([`crate::enter`]) before its first
/// untrusted read. On Windows the parent creates it in an AppContainer inside a job object.
pub fn run_sandboxed(exe: &Path, input: &Path, args: &[&OsStr]) -> Result<Outcome, Error> {
    #[cfg(windows)]
    {
        crate::windows::run(exe, input, args)
    }
    #[cfg(not(windows))]
    {
        run_unsandboxed(exe, &sandboxed_args(input, args))
    }
}

/// The child's arguments for a sandboxed run: the sandbox flag, the input, then the probe.
pub(crate) fn sandboxed_args<'a>(input: &'a Path, args: &[&'a OsStr]) -> Vec<&'a OsStr> {
    let mut full: Vec<&OsStr> = vec![OsStr::new(SANDBOX_FLAG), input.as_os_str()];
    full.extend_from_slice(args);
    full
}
