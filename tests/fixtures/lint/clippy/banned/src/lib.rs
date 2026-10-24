//! Lint fixture (F-014): one call to every method `clippy.toml` disallows, plus `unwrap`/`expect`
//! outside and inside tests. `crates/harness/tests/lint_gates.rs` copies this folder into a temp
//! workspace (renaming `Cargo.fixture.toml` to `Cargo.toml`) with the real workspace lints, runs
//! clippy with each clippy.toml and checks which calls are reported. It is never built as part of
//! the Lecter workspace.

use std::fs::{DirBuilder, File, OpenOptions};
use std::io::Result;
use std::net::{TcpListener, TcpStream, ToSocketAddrs, UdpSocket};
use std::path::PathBuf;
use std::time::Duration;

/// Blocking sleep.
pub fn sleep() {
    std::thread::sleep(Duration::from_millis(1));
}

/// Every blocking `std::fs` call the async crates ban.
pub fn fs(p: &str) -> Result<()> {
    std::fs::canonicalize(p)?;
    std::fs::copy(p, p)?;
    std::fs::create_dir(p)?;
    std::fs::create_dir_all(p)?;
    std::fs::exists(p)?;
    std::fs::hard_link(p, p)?;
    let meta = std::fs::metadata(p)?;
    std::fs::read(p)?;
    std::fs::read_dir(p)?;
    std::fs::read_link(p)?;
    std::fs::read_to_string(p)?;
    std::fs::remove_dir(p)?;
    std::fs::remove_dir_all(p)?;
    std::fs::remove_file(p)?;
    std::fs::rename(p, p)?;
    std::fs::set_permissions(p, meta.permissions())?;
    std::fs::symlink_metadata(p)?;
    std::fs::write(p, b"")?;
    File::open(p)?;
    File::create_new(p)?;
    let f = File::create(p)?;
    f.sync_all()?;
    f.sync_data()?;
    OpenOptions::new().read(true).open(p)?;
    DirBuilder::new().create(p)?;
    Ok(())
}

/// Every blocking `std::net` call the async crates ban.
pub fn net(addr: &str) -> Result<()> {
    let mut addrs = addr.to_socket_addrs()?;
    let sa = addrs.next().ok_or(std::io::ErrorKind::NotFound)?;
    TcpStream::connect(sa)?;
    TcpStream::connect_timeout(&sa, Duration::from_millis(1))?;
    let l = TcpListener::bind(sa)?;
    l.accept()?;
    let _ = l.incoming().next();
    let u = UdpSocket::bind(sa)?;
    u.connect(sa)?;
    u.send(b"")?;
    u.send_to(b"", sa)?;
    let mut buf = [0u8; 1];
    u.recv(&mut buf)?;
    u.recv_from(&mut buf)?;
    Ok(())
}

/// Tauri's identifier-based path helpers (a local stand-in crate named `tauri`; the lint stage
/// checks the same paths against the real Tauri in `lecter-app`).
pub fn tauri_paths(r: &tauri::path::PathResolver) -> Vec<PathBuf> {
    vec![r.app_config_dir(), r.app_data_dir(), r.app_cache_dir(), r.app_local_data_dir(), r.app_log_dir()]
}

/// `unwrap` and `expect` outside tests: denied (UNWRAP_OUTSIDE_TEST, EXPECT_OUTSIDE_TEST).
pub fn unwrap_outside_test(v: Option<u8>) -> u8 {
    v.unwrap() + v.expect("EXPECT_OUTSIDE_TEST")
}

#[cfg(test)]
mod tests {
    #[test]
    fn unwrap_inside_test() {
        let v = std::hint::black_box(Some(1u8));
        assert_eq!(v.unwrap() + v.expect("EXPECT_INSIDE_TEST"), 2);
    }
}
