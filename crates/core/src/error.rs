//! The core's one error type (`crates/CLAUDE.md`): every fallible core function returns
//! [`Result`].

/// Why a core operation failed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    /// The OS reports no home directory, so the config, data and cache folders have nowhere to go.
    #[error("no home directory: the config, data and cache folders have nowhere to go")]
    NoHome,
    /// The test home is empty or relative; resolving it against the working directory could land
    /// anywhere, so it is refused.
    #[cfg(any(debug_assertions, feature = "test-hooks"))]
    #[error("the test home must be an absolute path")]
    TestHomeNotAbsolute,
}

/// The core's result type.
pub type Result<T> = std::result::Result<T, Error>;
