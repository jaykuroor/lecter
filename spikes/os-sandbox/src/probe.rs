//! The probe child's command line and exit codes (`src/bin/sandbox-probe.rs`).
//!
//! `sandbox-probe [--sandbox <input>] <probe> <arg>` where probe is one of:
//! - `read <path>`: read the whole file;
//! - `net <ip:port>`: open a TCP connection (5 s timeout);
//! - `alloc <MiB>`: allocate and touch that many MiB in 16 MiB chunks.

/// The probe did what it was asked.
pub const OK: i32 = 0;
/// Bad command line.
pub const USAGE: i32 = 2;
/// The OS refused the probe (permission denied, socket refused, allocation failed).
pub const DENIED: i32 = 10;
/// The sandbox could not be applied; the probe did not run.
pub const SANDBOX_FAILED: i32 = 20;

/// The flag that makes the child call [`crate::enter`] with the next argument.
pub const SANDBOX_FLAG: &str = "--sandbox";

/// Allocation chunk for the `alloc` probe.
pub const ALLOC_CHUNK_BYTES: usize = 16 << 20;
