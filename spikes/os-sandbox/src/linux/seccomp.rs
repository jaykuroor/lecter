//! A seccomp-BPF filter, built by hand: a foreign architecture (or x32 on x86_64) kills the process;
//! socket, io_uring and cross-process memory calls fail with `EPERM`; no new processes (`clone`
//! only with `CLONE_THREAD`, `clone3` → `ENOSYS` so libc falls back to `clone`, `fork`/`vfork` →
//! `EPERM`), because `RLIMIT_AS` is per process and N children would get N GiB. Everything else is
//! allowed.
//!
//! A deny list is enough for the spike's question (no network); the parse worker should move to an
//! allow list once its syscall set is known.

use crate::Error;

#[repr(C)]
struct SockFilter {
    code: u16,
    jt: u8,
    jf: u8,
    k: u32,
}

#[repr(C)]
struct SockFprog {
    len: libc::c_ushort,
    filter: *const SockFilter,
}

const LD_W_ABS: u16 = 0x20;
const JEQ_K: u16 = 0x15;
const JSET_K: u16 = 0x45;
#[cfg(target_arch = "x86_64")]
const JGE_K: u16 = 0x35;
const RET_K: u16 = 0x06;
const OFFSET_NR: u32 = 0;
const OFFSET_ARCH: u32 = 4;
/// Low 32 bits of `args[0]` (little endian), the `flags` of `clone` on x86_64 and aarch64.
const OFFSET_ARG0_LO: u32 = 16;

#[cfg(target_arch = "x86_64")]
const AUDIT_ARCH: u32 = 0xC000_003E;
#[cfg(target_arch = "aarch64")]
const AUDIT_ARCH: u32 = 0xC000_00B7;

const DENIED: &[libc::c_long] = &[
    libc::SYS_socket,
    libc::SYS_socketpair,
    libc::SYS_connect,
    libc::SYS_bind,
    libc::SYS_listen,
    libc::SYS_accept,
    libc::SYS_accept4,
    libc::SYS_io_uring_setup,
    libc::SYS_io_uring_enter,
    libc::SYS_io_uring_register,
    libc::SYS_ptrace,
    libc::SYS_process_vm_readv,
    libc::SYS_process_vm_writev,
    #[cfg(target_arch = "x86_64")]
    libc::SYS_fork,
    #[cfg(target_arch = "x86_64")]
    libc::SYS_vfork,
];

fn stmt(code: u16, k: u32) -> SockFilter {
    SockFilter { code, jt: 0, jf: 0, k }
}

fn jump(code: u16, k: u32, jt: u8, jf: u8) -> SockFilter {
    SockFilter { code, jt, jf, k }
}

fn program() -> Vec<SockFilter> {
    let kill = libc::SECCOMP_RET_KILL_PROCESS;
    let eperm = libc::SECCOMP_RET_ERRNO | libc::EPERM as u32;
    let mut p =
        vec![stmt(LD_W_ABS, OFFSET_ARCH), jump(JEQ_K, AUDIT_ARCH, 1, 0), stmt(RET_K, kill), stmt(LD_W_ABS, OFFSET_NR)];
    #[cfg(target_arch = "x86_64")]
    {
        // x32 syscalls carry bit 30; they would bypass the numbers below.
        p.push(jump(JGE_K, 0x4000_0000, 0, 1));
        p.push(stmt(RET_K, kill));
    }
    // clone: threads only. Every branch returns, so the accumulator holds `nr` again below.
    p.push(jump(JEQ_K, libc::SYS_clone as u32, 0, 4));
    p.push(stmt(LD_W_ABS, OFFSET_ARG0_LO));
    p.push(jump(JSET_K, libc::CLONE_THREAD as u32, 0, 1));
    p.push(stmt(RET_K, libc::SECCOMP_RET_ALLOW));
    p.push(stmt(RET_K, eperm));
    // clone3 passes flags in memory BPF can't read; ENOSYS makes glibc/musl fall back to clone.
    p.push(jump(JEQ_K, libc::SYS_clone3 as u32, 0, 1));
    p.push(stmt(RET_K, libc::SECCOMP_RET_ERRNO | libc::ENOSYS as u32));
    for &nr in DENIED {
        p.push(jump(JEQ_K, nr as u32, 0, 1));
        p.push(stmt(RET_K, eperm));
    }
    p.push(stmt(RET_K, libc::SECCOMP_RET_ALLOW));
    p
}

/// Installs the filter on every thread of the process. Needs `no_new_privs`.
pub fn install() -> Result<(), Error> {
    let filter = program();
    let prog = SockFprog { len: filter.len() as libc::c_ushort, filter: filter.as_ptr() };
    // SAFETY: `prog` points at `filter`, which lives until the call returns; the kernel copies it.
    let rc = unsafe {
        libc::syscall(libc::SYS_seccomp, libc::SECCOMP_SET_MODE_FILTER, libc::SECCOMP_FILTER_FLAG_TSYNC, &prog)
    };
    if rc != 0 {
        return Err(Error::last_os("seccomp(SET_MODE_FILTER)"));
    }
    Ok(())
}
