//! Linux: `RLIMIT_AS`, `no_new_privs`, Landlock, then seccomp. Applied by the child to itself.

mod landlock;
mod seccomp;

use std::path::Path;

use crate::{Error, MEMORY_LIMIT_BYTES};

/// Restricts the calling process: 1 GiB address space, read access to `input` only, no sockets.
pub fn enter(input: &Path) -> Result<String, Error> {
    let limit = libc::rlimit { rlim_cur: MEMORY_LIMIT_BYTES, rlim_max: MEMORY_LIMIT_BYTES };
    // SAFETY: `limit` is a valid rlimit that outlives the call.
    if unsafe { libc::setrlimit(libc::RLIMIT_AS, &limit) } != 0 {
        return Err(Error::last_os("setrlimit(RLIMIT_AS)"));
    }
    // SAFETY: plain prctl with integer arguments.
    if unsafe { libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) } != 0 {
        return Err(Error::last_os("prctl(PR_SET_NO_NEW_PRIVS)"));
    }
    let abi = landlock::restrict_to_file(input)?;
    seccomp::install()?;
    Ok(format!("RLIMIT_AS 1 GiB + Landlock ABI {abi} + seccomp"))
}
