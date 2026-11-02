//! The `lecter-parse` worker process (`lecter_parse::worker`).

fn main() -> std::process::ExitCode {
    lecter_parse::worker::main(std::env::args_os().skip(1))
}
