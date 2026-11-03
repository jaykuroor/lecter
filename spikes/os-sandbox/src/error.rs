//! The spike's one error type: which step failed, and the OS error behind it.

use std::fmt;
use std::io;

/// A sandbox step failed.
#[derive(Debug)]
pub struct Error {
    /// The step that failed, for example `landlock_restrict_self`.
    pub step: &'static str,
    /// The OS error.
    pub source: io::Error,
}

impl Error {
    /// Wraps an existing I/O error.
    pub fn new(step: &'static str, source: io::Error) -> Self {
        Self { step, source }
    }

    /// The calling thread's last OS error (`errno` / `GetLastError`).
    pub fn last_os(step: &'static str) -> Self {
        Self::new(step, io::Error::last_os_error())
    }

    /// An error with a plain message.
    pub fn other(step: &'static str, message: impl Into<String>) -> Self {
        Self::new(step, io::Error::other(message.into()))
    }

    /// This OS has no sandbox implementation.
    #[cfg_attr(any(target_os = "linux", target_os = "macos", windows), allow(dead_code))]
    pub fn unsupported(step: &'static str) -> Self {
        Self::new(step, io::Error::from(io::ErrorKind::Unsupported))
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.step, self.source)
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.source)
    }
}

#[cfg(test)]
mod tests {
    use super::Error;

    #[test]
    fn message_names_the_step_then_the_os_error() {
        let e = Error::other("landlock_restrict_self", "operation not permitted");
        assert_eq!(e.to_string(), "landlock_restrict_self: operation not permitted");
    }

    #[test]
    fn source_is_the_os_error() {
        let e = Error::other("close_range(3, ~0)", "bad fd");
        let source = std::error::Error::source(&e).map(ToString::to_string);
        assert_eq!(source.as_deref(), Some("bad fd"));
    }
}
