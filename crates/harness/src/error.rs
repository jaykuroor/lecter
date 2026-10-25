//! Harness errors, printed as `{"error":{"code","message","retryable"}}`: the shape and codes of
//! `IpcError` in `18-contracts.md#error-codes`, so a harness check reads like the app's IPC.

use serde_json::{Value, json};

/// The error codes of `18-contracts.md#error-codes`: the one list in `lecter-core`, which the
/// app's `IpcError` uses too.
pub use lecter_core::ErrorCode;

/// How a harness call that failed with a code ends the process.
pub trait ExitStatus {
    /// The process exit status: 2 for a bad call (usage), 1 for everything else.
    fn exit_status(self) -> u8;
}

impl ExitStatus for ErrorCode {
    fn exit_status(self) -> u8 {
        match self {
            Self::InvalidArgument => 2,
            _ => 1,
        }
    }
}

/// A failed harness call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HarnessError {
    /// What kind of failure.
    pub code: ErrorCode,
    /// One English sentence for the person or agent running the harness; never content or secrets.
    pub message: String,
    /// Whether the same call may succeed if repeated.
    pub retryable: bool,
}

impl HarnessError {
    /// A non-retryable error.
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), retryable: false }
    }

    /// A bad call: unknown command or flag, missing or extra arguments.
    pub fn invalid_argument(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidArgument, message)
    }

    /// `{"error":{"code":…,"message":…,"retryable":…}}`.
    pub fn to_json(&self) -> Value {
        json!({ "error": { "code": self.code.as_str(), "message": self.message, "retryable": self.retryable } })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The codes in the first column of the table under `### Error codes` in 18-contracts.md.
    fn spec_codes() -> Vec<String> {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../docs/spec/18-contracts.md");
        let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{path}: {e}"));
        let section = text.split("### Error codes").nth(1).expect("an Error codes section");
        section
            .lines()
            .skip_while(|l| !l.starts_with('|'))
            .take_while(|l| l.starts_with('|'))
            .filter_map(|l| l.split('|').nth(1).map(|c| c.trim().trim_matches('`').to_owned()))
            .filter(|c| c.starts_with("E_"))
            .collect()
    }

    #[test]
    fn codes_are_exactly_the_contract_table_in_order() {
        let ours: Vec<&str> = ErrorCode::ALL.iter().map(|c| c.as_str()).collect();
        assert_eq!(ours, spec_codes());
    }

    #[test]
    fn error_json_has_code_message_and_retryable_under_error() {
        let e = HarnessError::invalid_argument("unknown command \"x\"");
        let v = e.to_json();
        assert_eq!(
            v,
            json!({ "error": { "code": "E_INVALID_ARGUMENT", "message": "unknown command \"x\"", "retryable": false } })
        );
    }

    #[test]
    fn only_a_bad_call_exits_with_status_2_and_every_code_is_non_zero() {
        for code in ErrorCode::ALL {
            let want = if code == ErrorCode::InvalidArgument { 2 } else { 1 };
            assert_eq!(code.exit_status(), want, "{code:?}");
        }
    }
}
