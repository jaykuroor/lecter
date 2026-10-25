//! What can go wrong reading a file, mapped onto the protocol's [`FailCode`].

use crate::proto::FailCode;

/// A parse failure. Messages name the problem or the limit, never the file's text.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    /// The file could not be opened or read.
    #[error("{0}")]
    Io(String),
    /// The file is damaged, encrypted or not a PDF.
    #[error("{0}")]
    Unreadable(String),
    /// The file is over one of the SEC-04 limits.
    #[error("{0}")]
    Limit(String),
    /// PDFium could not be found or loaded.
    #[error("{0}")]
    Engine(String),
}

impl Error {
    /// The protocol code for this failure.
    pub fn code(&self) -> FailCode {
        match self {
            Self::Io(_) => FailCode::Io,
            Self::Unreadable(_) => FailCode::Unreadable,
            Self::Limit(_) => FailCode::Limit,
            Self::Engine(_) => FailCode::Engine,
        }
    }
}

/// A `Result` with this crate's [`Error`].
pub type Result<T> = std::result::Result<T, Error>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_error_maps_to_its_own_code() {
        let pairs = [
            (Error::Io("a".into()), FailCode::Io),
            (Error::Unreadable("a".into()), FailCode::Unreadable),
            (Error::Limit("a".into()), FailCode::Limit),
            (Error::Engine("a".into()), FailCode::Engine),
        ];
        for (e, code) in pairs {
            assert_eq!(e.code(), code, "{e:?}");
        }
        assert_eq!(Error::Limit("over 2000 pages".into()).to_string(), "over 2000 pages");
    }
}
