//! The ruleset per Landlock ABI. Expected masks come from uapi `linux/landlock.h`: FS rights
//! EXECUTE..MAKE_SYM are bits 0-12 (ABI 1), REFER bit 13 (ABI 2), TRUNCATE bit 14 (ABI 3), IOCTL_DEV
//! bit 15 (ABI 5), RESOLVE_UNIX bit 16 (ABI 9); NET BIND_TCP/CONNECT_TCP bits 0-1 (ABI 4),
//! BIND_UDP/CONNECT_SEND_UDP bits 2-3 (ABI 10); SCOPE ABSTRACT_UNIX_SOCKET/SIGNAL bits 0-1 (ABI 6).
//! The kernel reads 8 bytes of the attr up to ABI 3, 16 at ABI 4-5 and 24 from ABI 6.

use super::{RulesetAttr, ruleset};

fn expect(abi: i64, fs: u64, net: u64, scoped: u64, size: usize) {
    let got = ruleset(abi);
    let want = Some((RulesetAttr { handled_access_fs: fs, handled_access_net: net, scoped }, size));
    assert_eq!(got, want, "ABI {abi}");
}

#[test]
fn no_landlock_means_no_ruleset() {
    // The version query returns -1 (ENOSYS / EOPNOTSUPP) when Landlock is missing or disabled.
    assert_eq!(ruleset(-1), None);
    assert_eq!(ruleset(0), None);
}

#[test]
fn abi_1_to_3_handle_only_files() {
    expect(1, 0x1fff, 0, 0, 8);
    expect(2, 0x3fff, 0, 0, 8);
    expect(3, 0x7fff, 0, 0, 8);
}

#[test]
fn abi_4_and_5_add_tcp() {
    expect(4, 0x7fff, 0b11, 0, 16);
    expect(5, 0xffff, 0b11, 0, 16);
}

#[test]
fn abi_6_to_9_add_scopes() {
    expect(6, 0xffff, 0b11, 0b11, 24);
    expect(8, 0xffff, 0b11, 0b11, 24);
    expect(9, 0x1ffff, 0b11, 0b11, 24);
}

#[test]
fn abi_10_and_later_add_udp() {
    expect(10, 0x1ffff, 0b1111, 0b11, 24);
    expect(11, 0x1ffff, 0b1111, 0b11, 24);
}
