//! macOS: close inherited fds, `RLIMIT_AS`, then a Seatbelt profile through `sandbox_init`. Applied by
//! the child to itself. `(deny default)` also denies `process-fork` and `process-exec`, so the child
//! can't start processes to multiply the per-process memory limit.
//!
//! A macOS process already maps the dyld shared region (several GiB of address space) at start, and
//! XNU refuses an `RLIMIT_AS` below the current map size. So the limit is the size at entry + 1 GiB:
//! the child cannot map more than 1 GiB beyond what it had when it entered the sandbox.

use std::ffi::{CStr, CString, c_char, c_int};

use crate::{Error, MEMORY_LIMIT_BYTES};

/// `mach_task_basic_info` (`<mach/task_info.h>`, `#pragma pack(4)`).
#[repr(C, packed(4))]
#[derive(Default)]
struct MachTaskBasicInfo {
    virtual_size: u64,
    resident_size: u64,
    resident_size_max: u64,
    user_time: [i32; 2],
    system_time: [i32; 2],
    policy: i32,
    suspend_count: i32,
}

const MACH_TASK_BASIC_INFO: u32 = 20;

unsafe extern "C" {
    static mach_task_self_: u32;
    fn task_info(task: u32, flavor: u32, info: *mut i32, count: *mut u32) -> c_int;
    fn sandbox_init(profile: *const c_char, flags: u64, errorbuf: *mut *mut c_char) -> c_int;
    fn sandbox_free_error(errorbuf: *mut c_char);
}

/// The task's current virtual size in bytes.
fn virtual_size() -> Result<u64, Error> {
    let mut info = MachTaskBasicInfo::default();
    let mut count = (size_of::<MachTaskBasicInfo>() / size_of::<i32>()) as u32;
    // SAFETY: `info` is a mach_task_basic_info and `count` its size in integer_t units.
    let kr = unsafe { task_info(mach_task_self_, MACH_TASK_BASIC_INFO, (&raw mut info).cast::<i32>(), &mut count) };
    if kr != 0 {
        return Err(Error::other("task_info(MACH_TASK_BASIC_INFO)", format!("kern_return_t {kr}")));
    }
    Ok(info.virtual_size)
}

/// Escapes a path for an SBPL string literal.
fn sbpl_string(path: &str) -> String {
    path.replace('\\', "\\\\").replace('"', "\\\"")
}

/// The Seatbelt profile: deny everything, read the input file.
pub fn profile(input: &str) -> String {
    format!("(version 1)\n(deny default)\n(allow file-read* (literal \"{}\"))\n", sbpl_string(input))
}

/// Closes every fd above stderr: Seatbelt only checks new opens, so an inherited fd without CLOEXEC
/// (a socket, a file) would stay usable. `/dev/fd` lists exactly this process's open fds.
fn close_inherited_fds() -> Result<(), Error> {
    let fds: Vec<c_int> = std::fs::read_dir("/dev/fd")
        .map_err(|e| Error::new("read_dir /dev/fd", e))?
        .filter_map(|e| e.ok()?.file_name().to_str()?.parse().ok())
        .collect();
    for fd in fds.into_iter().filter(|&fd| fd > 2) {
        // SAFETY: closing fds this process owns; EBADF for the already-closed read_dir fd is fine.
        unsafe { libc::close(fd) };
    }
    Ok(())
}

/// Restricts the calling process: map size at most +1 GiB, read access to `input` only, no network,
/// no new processes, no inherited fds.
pub fn enter(input: &std::path::Path) -> Result<String, Error> {
    close_inherited_fds()?;
    // Seatbelt matches the resolved path (/var → /private/var).
    let real = input.canonicalize().map_err(|e| Error::new("canonicalize input", e))?;
    let real = real.to_str().ok_or_else(|| Error::other("input path", "not UTF-8"))?;

    let limit = virtual_size()?.saturating_add(MEMORY_LIMIT_BYTES);
    let rlim = libc::rlimit { rlim_cur: limit, rlim_max: limit };
    // SAFETY: `rlim` is a valid rlimit that outlives the call.
    if unsafe { libc::setrlimit(libc::RLIMIT_AS, &rlim) } != 0 {
        return Err(Error::last_os("setrlimit(RLIMIT_AS)"));
    }

    let profile = CString::new(profile(real)).map_err(|_| Error::other("profile", "NUL byte"))?;
    let mut err: *mut c_char = std::ptr::null_mut();
    // SAFETY: `profile` is NUL-terminated; flags 0 means "profile is SBPL text"; `err` receives a
    // string we free with sandbox_free_error.
    let rc = unsafe { sandbox_init(profile.as_ptr(), 0, &mut err) };
    if rc != 0 {
        let message = if err.is_null() {
            format!("sandbox_init returned {rc}")
        } else {
            // SAFETY: on failure `err` is a NUL-terminated string owned by libsandbox.
            let m = unsafe { CStr::from_ptr(err) }.to_string_lossy().into_owned();
            // SAFETY: freed exactly once.
            unsafe { sandbox_free_error(err) };
            m
        };
        return Err(Error::other("sandbox_init", message));
    }
    Ok(format!("fds closed + RLIMIT_AS +1 GiB ({limit} bytes) + Seatbelt deny-default"))
}
