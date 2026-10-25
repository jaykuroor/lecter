//! `lecter-core`: Course and lecture files, document model, journal, jobs, settings and keychain.

pub mod error;
pub mod error_code;
pub mod identity;
pub mod paths;
#[cfg(any(debug_assertions, feature = "test-hooks"))]
pub mod testenv;

pub use error::{Error, Result};
pub use error_code::ErrorCode;

/// This crate's package name.
pub const NAME: &str = env!("CARGO_PKG_NAME");

/// This crate's version, inherited from the workspace.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    #[test]
    fn crate_is_named_after_its_folder_and_carries_a_semver_version() {
        assert_eq!(super::NAME, "lecter-core");
        let parts: Vec<&str> = super::VERSION.split('.').collect();
        assert_eq!(parts.len(), 3, "{}", super::VERSION);
        assert!(parts.iter().all(|p| p.parse::<u32>().is_ok()), "{}", super::VERSION);
    }
}
