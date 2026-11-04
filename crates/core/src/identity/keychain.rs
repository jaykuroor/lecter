//! The OS keychain as the migration sees it (`01-architecture.md#app-identity-and-migration`):
//! one secret per (service, account). The real backend (the `keyring` crate, SEC-40) arrives with
//! the provider keys; tests use an in-memory fake.

/// Why a keychain call failed. Messages never contain a secret.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum KeychainError {
    /// No keychain can be reached (Linux without a Secret Service, a locked keychain): nothing can
    /// be read or saved now, so a migration stops and runs again on the next start (SEC-42).
    #[error("the OS keychain is not available")]
    Unavailable,
    /// One item could not be read, saved or removed; others may still work.
    #[error("the OS keychain refused: {0}")]
    Failed(String),
}

/// The calls the migration makes on the OS keychain. A backend never logs a secret.
pub trait Keychain {
    /// The secret saved for `account` under `service`, or `None` when there is none.
    fn get(&self, service: &str, account: &str) -> Result<Option<Vec<u8>>, KeychainError>;
    /// Saves `secret` for `account` under `service`, replacing any secret already there.
    fn set(&self, service: &str, account: &str, secret: &[u8]) -> Result<(), KeychainError>;
    /// Removes the secret for `account` under `service`; removing a missing one is not an error.
    fn delete(&self, service: &str, account: &str) -> Result<(), KeychainError>;
}
