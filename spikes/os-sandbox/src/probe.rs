//! The probe child's command line and exit codes (`src/bin/sandbox-probe.rs`).
//!
//! `sandbox-probe [--thread-first] [--sandbox <input> [--input-handle <h>]] <probe> [arg]` where probe is:
//! - `read <path>`: read the whole file;
//! - `read-input`: read the input (by path, or through the inherited handle on Windows);
//! - `net <ip:port>`: open a TCP connection (5 s timeout);
//! - `alloc <MiB>`: allocate and touch that many MiB in 16 MiB chunks;
//! - `spawn-alloc <MiB>`: start a second process (fork on Unix, itself on Windows); both allocate;
//! - `thread`: start and join a thread;
//! - `use-fd <n>` (Unix): write one byte to an inherited fd.

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

/// Windows only: the flag before the inherited input handle's value (the AppContainer has no ACE on
/// the input file, so `read-input` reads this handle instead of opening the path).
pub const INPUT_HANDLE_FLAG: &str = "--input-handle";

/// Debug flag: start a thread before [`crate::enter`] (it must then refuse on Linux).
pub const THREAD_FIRST_FLAG: &str = "--thread-first";

/// Allocation chunk for the `alloc` probe.
pub const ALLOC_CHUNK_BYTES: usize = 16 << 20;
