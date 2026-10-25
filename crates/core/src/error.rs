//! The core's one error type (`crates/CLAUDE.md`): every fallible core function returns
//! [`Result`].

use crate::error_code::ErrorCode;

/// Why a core operation failed. The course errors' messages are one English sentence for the user;
/// they may name a course-relative file, never its content.
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
    /// A course folder path that isn't absolute; resolving it against the working directory could
    /// land anywhere.
    #[error("The chosen folder path is not absolute.")]
    NotAbsolute,
    /// The course folder doesn't exist (any more).
    #[error("That folder no longer exists.")]
    FolderNotFound,
    /// The chosen path is a file (or a link to one), not a folder.
    #[error("Choose a folder, not a file.")]
    NotAFolder,
    /// The course folder's path isn't valid Unicode, which the UI and the course files can't hold.
    #[error("The folder's path is not valid Unicode.")]
    NotUnicode,
    /// A course entry (course-relative, e.g. `slides/x.pdf`) resolves outside the course root
    /// (SEC-35): a symlink out of the course.
    #[error("{0} points outside the course folder; move it into the course or remove the link.")]
    OutsideCourse(String),
    /// A course subfolder holds more entries than one listing reads.
    #[error("{folder}/ holds more than {limit} entries.")]
    TooManyEntries {
        /// The subfolder, e.g. `slides`.
        folder: &'static str,
        /// The most entries a listing reads.
        limit: usize,
    },
    /// The file system refused (permissions, a broken disk, …).
    #[error("Lecter could not read that folder.")]
    Io(std::io::ErrorKind),
    /// The parse worker failed, crashed, timed out or hit a limit (SEC-04). The message is one
    /// sentence for the user and never quotes the file's text.
    #[error("{0}")]
    ParseFailed(String),
}

impl Error {
    /// The `18-contracts.md#error-codes` code the app and the harness report for this error.
    pub const fn code(&self) -> ErrorCode {
        match self {
            Self::FolderNotFound => ErrorCode::NotFound,
            Self::OutsideCourse(_) => ErrorCode::NotTrusted,
            Self::Io(_) => ErrorCode::Io,
            Self::NotAbsolute | Self::NotAFolder | Self::NotUnicode | Self::TooManyEntries { .. } => {
                ErrorCode::InvalidArgument
            }
            Self::NoHome => ErrorCode::Internal,
            Self::ParseFailed(_) => ErrorCode::ParseFailed,
            #[cfg(any(debug_assertions, feature = "test-hooks"))]
            Self::TestHomeNotAbsolute => ErrorCode::InvalidArgument,
        }
    }
}

/// The core's result type.
pub type Result<T> = std::result::Result<T, Error>;

#[cfg(test)]
mod tests {
    use super::*;

    /// 18-contracts.md#error-codes: missing → E_NOT_FOUND, escaping the course → E_NOT_TRUSTED
    /// (SEC-35), bad input → E_INVALID_ARGUMENT, the file system → E_IO.
    #[test]
    fn course_errors_carry_their_contract_codes() {
        let cases = [
            (Error::FolderNotFound, ErrorCode::NotFound),
            (Error::OutsideCourse("slides/x.pdf".into()), ErrorCode::NotTrusted),
            (Error::Io(std::io::ErrorKind::PermissionDenied), ErrorCode::Io),
            (Error::NotAbsolute, ErrorCode::InvalidArgument),
            (Error::NotAFolder, ErrorCode::InvalidArgument),
            (Error::NotUnicode, ErrorCode::InvalidArgument),
            (Error::TooManyEntries { folder: "slides", limit: 10_000 }, ErrorCode::InvalidArgument),
            (Error::NoHome, ErrorCode::Internal),
            (Error::ParseFailed("The parse worker crashed.".into()), ErrorCode::ParseFailed),
        ];
        for (err, code) in cases {
            assert_eq!(err.code(), code, "{err:?}");
        }
    }

    #[test]
    fn course_messages_name_the_entry_and_the_limit() {
        let msg = Error::OutsideCourse("slides/x.pdf".into()).to_string();
        assert!(msg.starts_with("slides/x.pdf points outside the course folder"), "{msg}");
        let msg = Error::TooManyEntries { folder: "lectures", limit: 10_000 }.to_string();
        assert_eq!(msg, "lectures/ holds more than 10000 entries.");
    }
}
