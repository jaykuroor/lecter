//! The crate's one error type (crates/CLAUDE.md).

/// What can go wrong in `lecter-ai`. Messages are user-facing English and never hold prompt,
/// answer or slide text.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    /// The anchored block isn't in the lecture (deleted, or the id is wrong).
    #[error("That line is no longer in the lecture.")]
    BlockNotFound,
    /// The question is empty once trimmed.
    #[error("Type a question first.")]
    EmptyQuestion,
    /// The provider failed before or during the stream.
    #[error("The AI provider failed: {0}")]
    Provider(String),
}

/// `Result` with this crate's [`Error`].
pub type Result<T> = std::result::Result<T, Error>;
