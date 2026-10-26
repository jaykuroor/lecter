//! The index crate's errors, with the contract's codes (`18-contracts.md#error-codes`).

use lecter_core::ErrorCode;

/// Why indexing or a search failed. Messages are one user-facing sentence and never hold note text.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The course folder or its `.lecter/cache/index` folder: missing, a link out of the
    /// course, or not writable.
    #[error(transparent)]
    Course(#[from] lecter_core::Error),
    /// Another Lecter process is writing this course's index right now.
    #[error("The course's search index is busy in another Lecter window.")]
    Locked,
    /// Tantivy failed to read or write the index. The detail is Tantivy's own text (paths and
    /// kinds, never the indexed text), for the log.
    #[error("The course's search index could not be read or written.")]
    Index(String),
}

/// The index crate's result.
pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    /// The contract's error code for this error.
    pub fn code(&self) -> ErrorCode {
        match self {
            Self::Course(e) => e.code(),
            Self::Locked => ErrorCode::Locked,
            Self::Index(_) => ErrorCode::Io,
        }
    }
}

impl From<tantivy::TantivyError> for Error {
    fn from(e: tantivy::TantivyError) -> Self {
        match e {
            tantivy::TantivyError::LockFailure(..) => Self::Locked,
            other => Self::Index(other.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_error_has_its_contract_code() {
        let lock = tantivy::TantivyError::LockFailure(tantivy::directory::error::LockError::LockBusy, None);
        assert_eq!(Error::from(lock).code(), ErrorCode::Locked);
        let other = tantivy::TantivyError::SchemaError("x".into());
        assert_eq!(Error::from(other).code(), ErrorCode::Io);
        let course = Error::from(lecter_core::Error::OutsideCourse(".lecter/cache/index".into()));
        assert_eq!(course.code(), ErrorCode::NotTrusted);
    }
}
