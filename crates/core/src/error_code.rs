//! The error codes of `18-contracts.md#error-codes`, shared by the app's `IpcError` and the
//! harness's JSON errors so both speak one list (D-089 revisited in F-017).

use serde::{Deserialize, Serialize};

/// What kind of failure an IPC command (or a harness call) reports. On the wire it is the code's
/// string, e.g. `"E_INVALID_ARGUMENT"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ErrorCode {
    /// Validation failed.
    #[serde(rename = "E_INVALID_ARGUMENT")]
    InvalidArgument,
    /// File, course, lecture or id missing.
    #[serde(rename = "E_NOT_FOUND")]
    NotFound,
    /// Course is read-only or untrusted.
    #[serde(rename = "E_NOT_TRUSTED")]
    NotTrusted,
    /// File changed on disk.
    #[serde(rename = "E_CONFLICT")]
    Conflict,
    /// Course open elsewhere.
    #[serde(rename = "E_LOCKED")]
    Locked,
    /// Disk full, read-only, permission.
    #[serde(rename = "E_IO")]
    Io,
    /// Worker failed, crashed or hit a limit.
    #[serde(rename = "E_PARSE_FAILED")]
    ParseFailed,
    /// Key rejected or sign-in expired.
    #[serde(rename = "E_PROVIDER_AUTH")]
    ProviderAuth,
    /// Waiting in the token bucket or on `retry-after`.
    #[serde(rename = "E_RATE_LIMITED")]
    RateLimited,
    /// Spend cap reached.
    #[serde(rename = "E_BUDGET")]
    Budget,
    /// Timed out.
    #[serde(rename = "E_TIMEOUT")]
    Timeout,
    /// Other provider error (5xx, malformed).
    #[serde(rename = "E_PROVIDER")]
    Provider,
    /// User or shutdown cancelled.
    #[serde(rename = "E_CANCELLED")]
    Cancelled,
    /// Model lacks a capability.
    #[serde(rename = "E_UNSUPPORTED")]
    Unsupported,
    /// Bug.
    #[serde(rename = "E_INTERNAL")]
    Internal,
}

impl ErrorCode {
    /// Every code, in the spec table's order.
    pub const ALL: [Self; 15] = [
        Self::InvalidArgument,
        Self::NotFound,
        Self::NotTrusted,
        Self::Conflict,
        Self::Locked,
        Self::Io,
        Self::ParseFailed,
        Self::ProviderAuth,
        Self::RateLimited,
        Self::Budget,
        Self::Timeout,
        Self::Provider,
        Self::Cancelled,
        Self::Unsupported,
        Self::Internal,
    ];

    /// The wire string, e.g. `E_INVALID_ARGUMENT` (the same string serde writes).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidArgument => "E_INVALID_ARGUMENT",
            Self::NotFound => "E_NOT_FOUND",
            Self::NotTrusted => "E_NOT_TRUSTED",
            Self::Conflict => "E_CONFLICT",
            Self::Locked => "E_LOCKED",
            Self::Io => "E_IO",
            Self::ParseFailed => "E_PARSE_FAILED",
            Self::ProviderAuth => "E_PROVIDER_AUTH",
            Self::RateLimited => "E_RATE_LIMITED",
            Self::Budget => "E_BUDGET",
            Self::Timeout => "E_TIMEOUT",
            Self::Provider => "E_PROVIDER",
            Self::Cancelled => "E_CANCELLED",
            Self::Unsupported => "E_UNSUPPORTED",
            Self::Internal => "E_INTERNAL",
        }
    }

    /// Whether the same call may succeed if it is simply repeated, which is the default for an
    /// error's `retryable`: the codes whose UI behaviour in the spec table is to retry (E_IO keeps
    /// retrying, E_RATE_LIMITED waits, E_TIMEOUT and E_PROVIDER offer "Retry").
    pub const fn retryable(self) -> bool {
        matches!(self, Self::Io | Self::RateLimited | Self::Timeout | Self::Provider)
    }
}

#[cfg(test)]
#[allow(clippy::disallowed_methods, reason = "the test reads the spec file on a plain test thread")]
mod tests {
    use super::*;

    /// The codes in the first column of the table under `### Error codes` in 18-contracts.md.
    fn spec_codes() -> Vec<String> {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../docs/spec/18-contracts.md");
        let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{path}: {e}"));
        let section = text.split("### Error codes").nth(1).unwrap_or_else(|| panic!("no Error codes section"));
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
    fn serde_writes_and_reads_the_wire_string() {
        for code in ErrorCode::ALL {
            let json = serde_json::to_value(code).unwrap_or_else(|e| panic!("{e}"));
            assert_eq!(json, serde_json::Value::String(code.as_str().to_owned()));
            let back: ErrorCode = serde_json::from_value(json).unwrap_or_else(|e| panic!("{e}"));
            assert_eq!(back, code);
        }
    }

    #[test]
    fn only_the_retry_codes_are_retryable_by_default() {
        let retry: Vec<ErrorCode> = ErrorCode::ALL.into_iter().filter(|c| c.retryable()).collect();
        assert_eq!(retry, [ErrorCode::Io, ErrorCode::RateLimited, ErrorCode::Timeout, ErrorCode::Provider]);
    }
}
