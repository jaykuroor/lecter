//! Linux: the child applies all of this to itself, in this order:
//! close inherited fds, die with the parent, refuse if other threads exist, `RLIMIT_AS`,
//! `no_new_privs`, Landlock, then seccomp.

mod landlock;
mod seccomp;

use std::path::Path;

use crate::{Error, MEMORY_LIMIT_BYTES};

/// Closes every fd above stderr. Landlock only gates new opens and seccomp still allows
/// read/write/sendmsg, so an inherited fd without CLOEXEC (a socket, a file) would survive.
fn close_inherited_fds() -> Result<(), Error> {
    // SAFETY: close_range on our own fd table; nothing in this process holds fds ≥ 3 yet.
    if unsafe { libc::syscall(libc::SYS_close_range, 3u32, u32::MAX, 0u32) } != 0 {
        return Err(Error::last_os("close_range(3, ~0)"));
    }
    Ok(())
}

/// Landlock's `restrict_self` covers only the calling thread, so a thread started earlier would
/// stay unrestricted. The worker must call [`enter`] first; this refuses if it didn't.
fn ensure_single_thread() -> Result<(), Error> {
    #[allow(clippy::disallowed_methods, reason = "sync child process, before the sandbox exists")]
    let status = std::fs::read_to_string("/proc/self/status").map_err(|e| Error::new("read /proc/self/status", e))?;
    let threads = status
        .lines()
        .find_map(|l| l.strip_prefix("Threads:"))
        .and_then(|v| v.trim().parse::<u32>().ok())
        .ok_or_else(|| Error::other("thread count", "no Threads: line in /proc/self/status"))?;
    if threads != 1 {
        return Err(Error::other(
            "thread count",
            format!("{threads} threads; enter() must run before any thread starts"),
        ));
    }
    Ok(())
}

/// Restricts the calling process: 1 GiB address space, read access to `input` only, no sockets,
/// no new processes, no inherited fds, killed when its parent dies.
pub fn enter(input: &Path) -> Result<String, Error> {
    close_inherited_fds()?;
    // SAFETY: plain prctl with integer arguments.
    if unsafe { libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL, 0, 0, 0) } != 0 {
        return Err(Error::last_os("prctl(PR_SET_PDEATHSIG)"));
    }
    ensure_single_thread()?;
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
    Ok(format!("fds closed + PDEATHSIG + RLIMIT_AS 1 GiB + Landlock ABI {abi} + seccomp"))
}
