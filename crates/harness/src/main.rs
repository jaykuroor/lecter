//! The `lecter-harness` binary: one call per process (see the library docs).

use std::io::Write;
use std::process::ExitCode;

fn main() -> ExitCode {
    let mut args = std::env::args_os().skip(1).peekable();
    // `parse` runs this executable again as the parse worker (commands/parse.rs): stdin and
    // stdout then carry protocol frames, so nothing below may print.
    if args.peek().is_some_and(|a| a == lecter_harness::commands::WORKER_ARG) {
        return lecter_parse::worker::main(args.skip(1));
    }
    let out = lecter_harness::run(args);
    // A closed pipe or a full disk must end the call with a failure, not a panic.
    let mut stdout = std::io::stdout().lock();
    let mut stderr = std::io::stderr().lock();
    let wrote = stdout.write_all(out.stdout.as_bytes()).and_then(|()| stdout.flush()).is_ok()
        && stderr.write_all(out.stderr.as_bytes()).and_then(|()| stderr.flush()).is_ok();
    if wrote { ExitCode::from(out.status) } else { ExitCode::FAILURE }
}
