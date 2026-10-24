//! Landlock through raw syscalls (uapi `linux/landlock.h`): every file system right the kernel knows
//! is handled, and the only rule grants `READ_FILE` on the input. From ABI 4 TCP bind/connect are
//! handled too (no rule, so denied), and from ABI 6 abstract Unix sockets and signals are scoped.
//! Fails closed: no Landlock, no sandbox.

use std::ffi::CString;
use std::os::unix::ffi::OsStrExt;
use std::path::Path;

use crate::Error;

const CREATE_RULESET_VERSION: libc::c_uint = 1;
const RULE_PATH_BENEATH: libc::c_uint = 1;
const ACCESS_FS_READ_FILE: u64 = 1 << 2;

#[repr(C)]
struct RulesetAttr {
    handled_access_fs: u64,
    handled_access_net: u64,
    scoped: u64,
}

#[repr(C, packed)]
struct PathBeneathAttr {
    allowed_access: u64,
    parent_fd: i32,
}

/// Closes the file descriptor on drop.
struct Fd(libc::c_int);

impl Drop for Fd {
    fn drop(&mut self) {
        // SAFETY: the fd is owned by this guard and closed once.
        unsafe { libc::close(self.0) };
    }
}

/// The file system rights handled at a given ABI (ABI 1: bits 0-12; 2: REFER; 3: TRUNCATE; 5: IOCTL_DEV).
fn handled_fs(abi: i64) -> u64 {
    let mut access = (1u64 << 13) - 1;
    if abi >= 2 {
        access |= 1 << 13;
    }
    if abi >= 3 {
        access |= 1 << 14;
    }
    if abi >= 5 {
        access |= 1 << 15;
    }
    access
}

/// Restricts the process to reading `input`. Returns the kernel's Landlock ABI version.
pub fn restrict_to_file(input: &Path) -> Result<i64, Error> {
    // SAFETY: the version query takes a null attr and size 0.
    let abi = unsafe {
        libc::syscall(
            libc::SYS_landlock_create_ruleset,
            std::ptr::null::<RulesetAttr>(),
            0usize,
            CREATE_RULESET_VERSION,
        )
    };
    if abi < 1 {
        return Err(Error::last_os("landlock ABI version"));
    }
    let attr = RulesetAttr {
        handled_access_fs: handled_fs(abi),
        handled_access_net: if abi >= 4 { 0b11 } else { 0 },
        scoped: if abi >= 6 { 0b11 } else { 0 },
    };
    let size = match abi {
        1..=3 => 8usize,
        4 | 5 => 16,
        _ => size_of::<RulesetAttr>(),
    };
    // SAFETY: `attr` is valid for `size` bytes (size ≤ size_of::<RulesetAttr>()).
    let ruleset = unsafe { libc::syscall(libc::SYS_landlock_create_ruleset, &attr, size, 0u32) };
    if ruleset < 0 {
        return Err(Error::last_os("landlock_create_ruleset"));
    }
    let ruleset = Fd(ruleset as libc::c_int);

    let path = CString::new(input.as_os_str().as_bytes())
        .map_err(|_| Error::other("landlock input path", "path contains a NUL byte"))?;
    // SAFETY: `path` is a valid NUL-terminated string.
    let file = unsafe { libc::open(path.as_ptr(), libc::O_PATH | libc::O_CLOEXEC) };
    if file < 0 {
        return Err(Error::last_os("open input (O_PATH)"));
    }
    let file = Fd(file);
    let rule = PathBeneathAttr { allowed_access: ACCESS_FS_READ_FILE, parent_fd: file.0 };
    // SAFETY: `rule` is a valid landlock_path_beneath_attr; both fds are open.
    let added = unsafe { libc::syscall(libc::SYS_landlock_add_rule, ruleset.0, RULE_PATH_BENEATH, &rule, 0u32) };
    if added != 0 {
        return Err(Error::last_os("landlock_add_rule"));
    }
    // SAFETY: the ruleset fd is open; no_new_privs is already set by the caller.
    if unsafe { libc::syscall(libc::SYS_landlock_restrict_self, ruleset.0, 0u32) } != 0 {
        return Err(Error::last_os("landlock_restrict_self"));
    }
    Ok(abi)
}
