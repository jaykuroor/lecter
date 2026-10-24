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
