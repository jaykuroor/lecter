//! F-005 spike: sandbox one child process per OS (SEC-01, `13-security.md#untrusted-files`).
//!
//! Once sandboxed, the child has no network, can read only its one input file, and cannot hold more
//! than 1 GiB of memory.
//!
//! - **Linux:** the child restricts itself ([`enter`]): `RLIMIT_AS`, `no_new_privs`, Landlock (every
//!   file system right handled, one read rule for the input; TCP bind/connect handled from ABI 4) and
//!   a seccomp filter that fails socket, io_uring and ptrace-style calls with `EPERM`.
//! - **macOS:** the child restricts itself ([`enter`]): `RLIMIT_AS` at its current size + 1 GiB, then a
//!   Seatbelt profile (`deny default`, read the input literal).
//! - **Windows:** the parent launches the child ([`run_sandboxed`]) in an AppContainer with no
//!   capabilities (no network, files readable only where the ACL names the container) inside a job
//!   object with a 1 GiB process memory limit and one active process.
//!
//! Spike code (`spikes/CLAUDE.md`): never a dependency of `crates/`. The parse worker ports it.
#![allow(
    clippy::disallowed_methods,
    reason = "a synchronous worker-style spike, like crates/parse (whose clippy.toml allows blocking std::fs/std::net)"
)]

mod error;
mod launch;
pub mod probe;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;

pub use error::Error;
pub use launch::{Outcome, run_sandboxed, run_unsandboxed};

use std::path::Path;

/// The memory limit from SEC-01: 1 GiB.
pub const MEMORY_LIMIT_BYTES: u64 = 1 << 30;

/// Child side: sandbox the calling process so that it can read only `input`.
///
/// Call it first thing, before reading any untrusted byte. Returns a short description of what was
/// applied. On Windows the parent has already applied the sandbox ([`run_sandboxed`]), so this only
/// reports that.
pub fn enter(input: &Path) -> Result<String, Error> {
    #[cfg(target_os = "linux")]
    {
        linux::enter(input)
    }
    #[cfg(target_os = "macos")]
    {
        macos::enter(input)
    }
    #[cfg(windows)]
    {
        let _ = input;
        Ok("AppContainer + job object (applied by the parent)".to_owned())
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
    {
        let _ = input;
        Err(Error::unsupported("enter"))
    }
}
