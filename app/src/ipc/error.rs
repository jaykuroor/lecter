//! `IpcError`, the error every command returns (18-contracts.md#error-codes): `{ code, message,
//! retryable, detail? }`. `message` is user-facing English; `detail` never holds content or
//! secrets. Only the codes a command returns so far are listed; F-017 completes the table.

use serde::Serialize;

/// The codes of 18-contracts.md#error-codes that the shell's commands return.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ErrorCode {
    /// Validation failed.
    #[serde(rename = "E_INVALID_ARGUMENT")]
    InvalidArgument,
    /// File, course, lecture or id missing.
    #[serde(rename = "E_NOT_FOUND")]
    NotFound,
    /// Disk full, read-only, permission.
    #[serde(rename = "E_IO")]
    Io,
    /// Bug.
    #[serde(rename = "E_INTERNAL")]
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct IpcError {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl IpcError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), retryable: code == ErrorCode::Io, detail: None }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialises_to_the_contract_shape() {
        let e = IpcError::new(ErrorCode::NotFound, "That folder no longer exists.");
        let json = serde_json::to_value(&e).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(
            json,
            serde_json::json!({ "code": "E_NOT_FOUND", "message": "That folder no longer exists.", "retryable": false })
        );
    }

    #[test]
    fn only_io_errors_are_retryable() {
        assert!(IpcError::new(ErrorCode::Io, "x").retryable);
        for code in [ErrorCode::InvalidArgument, ErrorCode::NotFound, ErrorCode::Internal] {
            assert!(!IpcError::new(code, "x").retryable, "{code:?}");
        }
    }
}
