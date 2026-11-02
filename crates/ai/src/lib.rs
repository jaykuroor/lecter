//! `lecter-ai`: Provider adapters, agent loop, roles, tools, prompt caching and figures.
//!
//! v0 skeleton (F-023): the [`provider::Provider`] trait with the in-process scripted provider
//! (the tests' fake and the app's offline sample), the `a` request ([`prompt::ask_request`]), the
//! answer loop ([`ask::stream_answer`]) and the gloss as the lecture file stores it ([`gloss`]);
//! F-024 adds the sample plot ([`figures`]).

pub mod ask;
pub mod error;
pub mod figures;
pub mod gloss;
pub mod prompt;
pub mod provider;

pub use error::{Error, Result};
/// The cancel token every stream takes (crates/CLAUDE.md), re-exported so callers need no
/// tokio-util of their own.
pub use tokio_util::sync::CancellationToken;

/// This crate's package name.
pub const NAME: &str = env!("CARGO_PKG_NAME");

/// This crate's version, inherited from the workspace.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    #[test]
    fn crate_is_named_after_its_folder_and_carries_a_semver_version() {
        assert_eq!(super::NAME, "lecter-ai");
        let parts: Vec<&str> = super::VERSION.split('.').collect();
        assert_eq!(parts.len(), 3, "{}", super::VERSION);
        assert!(parts.iter().all(|p| p.parse::<u32>().is_ok()), "{}", super::VERSION);
    }
}
