//! `lecter-harness`: The core as JSON over the command line, for tests and agents. Never shipped.
//!
//! `lecter-harness <command> [args] [--json]` runs one command. With `--json` it prints exactly one
//! JSON value on stdout: the result, or `{"error":{"code","message","retryable"}}` with the codes
//! of `18-contracts.md#error-codes`. Errors exit non-zero (2 for a bad call, 1 otherwise). Without
//! `--json`, results are text on stdout and errors a line on stderr.

pub mod commands;
pub mod error;

use error::HarnessError;

/// This crate's package name.
pub const NAME: &str = env!("CARGO_PKG_NAME");

/// This crate's version, inherited from the workspace.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// The flag that switches output to one JSON value.
const JSON_FLAG: &str = "--json";

/// What one call prints and how it exits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outcome {
    /// Everything for stdout, newline-terminated (or empty).
    pub stdout: String,
    /// Everything for stderr, newline-terminated (or empty).
    pub stderr: String,
    /// The process exit status.
    pub status: u8,
}

/// Runs one call; `args` excludes the program name.
pub fn run<I>(args: I) -> Outcome
where
    I: IntoIterator<Item = std::ffi::OsString>,
{
    let mut json = false;
    let mut rest = Vec::new();
    let mut bad = None;
    for a in args {
        match a.into_string() {
            Ok(s) if s == JSON_FLAG => json = true,
            Ok(s) => rest.push(s),
            Err(_) => bad = bad.or(Some(HarnessError::invalid_argument("arguments must be valid UTF-8"))),
        }
    }
    let result = match bad {
        Some(e) => Err(e),
        None => dispatch(&rest),
    };
    match (result, json) {
        (Ok(r), true) => Outcome { stdout: format!("{}\n", r.json), stderr: String::new(), status: 0 },
        (Ok(r), false) => Outcome { stdout: format!("{}\n", r.text), stderr: String::new(), status: 0 },
        (Err(e), true) => {
            Outcome { stdout: format!("{}\n", e.to_json()), stderr: String::new(), status: e.code.exit_status() }
        }
        (Err(e), false) => Outcome {
            stdout: String::new(),
            stderr: format!("{NAME}: {}: {}\n", e.code.as_str(), e.message),
            status: e.code.exit_status(),
        },
    }
}

/// Finds the command and runs it with the remaining arguments.
fn dispatch(args: &[String]) -> Result<commands::Reply, HarnessError> {
    let choices = commands::names();
    let Some((name, rest)) = args.split_first() else {
        return Err(HarnessError::invalid_argument(format!("missing command; commands: {choices}")));
    };
    if let Some(flag) = args.iter().find(|a| a.starts_with("--")) {
        return Err(HarnessError::invalid_argument(format!(
            "unknown flag \"{flag}\"; the only global flag is {JSON_FLAG}"
        )));
    }
    match commands::find(name) {
        Some(c) => (c.run)(rest),
        None => Err(HarnessError::invalid_argument(format!("unknown command \"{name}\"; commands: {choices}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    fn call(args: &[&str]) -> Outcome {
        run(args.iter().map(OsString::from))
    }

    #[test]
    fn crate_is_named_after_its_folder_and_carries_a_semver_version() {
        assert_eq!(super::NAME, "lecter-harness");
        let parts: Vec<&str> = super::VERSION.split('.').collect();
        assert_eq!(parts.len(), 3, "{}", super::VERSION);
        assert!(parts.iter().all(|p| p.parse::<u32>().is_ok()), "{}", super::VERSION);
    }

    #[test]
    fn json_result_is_one_line_on_stdout() {
        let o = call(&["version", "--json"]);
        assert_eq!(o, Outcome { stdout: format!("{{\"version\":\"{VERSION}\"}}\n"), stderr: String::new(), status: 0 });
    }

    #[test]
    fn json_error_is_one_line_on_stdout_with_a_non_zero_status() {
        let o = call(&["--json", "nope"]);
        assert_eq!(o.status, 2);
        assert!(o.stderr.is_empty());
        let v: serde_json::Value = serde_json::from_str(o.stdout.trim_end()).unwrap();
        assert_eq!(v["error"]["code"], "E_INVALID_ARGUMENT");
        assert_eq!(o.stdout.lines().count(), 1);
    }

    #[test]
    fn text_error_is_one_line_on_stderr() {
        let o = call(&[]);
        assert_eq!(o.status, 2);
        assert!(o.stdout.is_empty());
        assert!(o.stderr.starts_with("lecter-harness: E_INVALID_ARGUMENT: missing command"), "{}", o.stderr);
        assert_eq!(o.stderr.lines().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn non_utf8_argument_is_an_invalid_argument() {
        use std::os::unix::ffi::OsStringExt;
        let o = run([OsString::from("version"), OsString::from_vec(vec![0xff]), OsString::from("--json")]);
        assert_eq!(o.status, 2);
        assert!(o.stdout.contains("UTF-8"), "{}", o.stdout);
    }
}
