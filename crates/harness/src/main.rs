//! The `lecter-harness` binary: one call per process (see the library docs).

use std::io::Write;
use std::process::ExitCode;

fn main() -> ExitCode {
    let out = lecter_harness::run(std::env::args_os().skip(1));
    // A closed pipe or a full disk must end the call with a failure, not a panic.
    let mut stdout = std::io::stdout().lock();
    let mut stderr = std::io::stderr().lock();
    let wrote = stdout.write_all(out.stdout.as_bytes()).and_then(|()| stdout.flush()).is_ok()
        && stderr.write_all(out.stderr.as_bytes()).and_then(|()| stderr.flush()).is_ok();
    if wrote { ExitCode::from(out.status) } else { ExitCode::FAILURE }
}
