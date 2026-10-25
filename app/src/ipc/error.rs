//! `IpcError`, the error every command returns (18-contracts.md#error-codes): `{ code, message,
//! retryable, detail? }`. `message` is user-facing English; `detail` never holds content or
//! secrets. The codes are the one list in `lecter_core::ErrorCode`, which the harness shares.

use serde::Serialize;
use specta::Type;

pub use lecter_core::ErrorCode;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct IpcError {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl IpcError {
    /// An error whose `retryable` is the code's default (`ErrorCode::retryable`).
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), retryable: code.retryable(), detail: None }
    }

    /// Adds a detail for logs and bug reports: names, limits, sizes; never content or secrets.
    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
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
    fn a_detail_is_serialised_when_set() {
        let e = IpcError::new(ErrorCode::InvalidArgument, "x").with_detail("prompt: 16384 bytes max");
        let json = serde_json::to_value(&e).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(json["detail"], "prompt: 16384 bytes max");
    }

    #[test]
    fn only_io_errors_are_retryable() {
        assert!(IpcError::new(ErrorCode::Io, "x").retryable);
        for code in [ErrorCode::InvalidArgument, ErrorCode::NotFound, ErrorCode::Internal] {
            assert!(!IpcError::new(code, "x").retryable, "{code:?}");
        }
    }

    /// Criterion 4: IpcError carries every code of 18-contracts.md#error-codes, each with its wire
    /// string (the list itself is pinned to the spec table in lecter_core::error_code).
    #[test]
    fn ipc_error_carries_every_contract_code() {
        assert_eq!(ErrorCode::ALL.len(), 15);
        for code in ErrorCode::ALL {
            let json = serde_json::to_value(IpcError::new(code, "x")).unwrap_or_else(|e| panic!("{e}"));
            assert_eq!(json["code"], code.as_str());
            assert_eq!(json["retryable"], code.retryable());
        }
    }
}
