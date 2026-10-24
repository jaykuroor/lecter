//! The child process the tests sandbox. Usage and exit codes: `lecter_spike_os_sandbox::probe`.
#![allow(
    clippy::disallowed_methods,
    reason = "a synchronous child process; blocking std::fs/std::net calls are the probes"
)]

use std::ffi::OsString;
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::process::ExitCode;
use std::time::Duration;

use lecter_spike_os_sandbox::enter;
use lecter_spike_os_sandbox::probe::{ALLOC_CHUNK_BYTES, DENIED, OK, SANDBOX_FAILED, SANDBOX_FLAG, USAGE};

/// The smallest page size of the three OSes.
const PAGE: usize = 4096;

fn read(path: &Path) -> i32 {
    match std::fs::read(path) {
        Ok(bytes) => {
            eprintln!("read {} bytes", bytes.len());
            OK
        }
        Err(e) => {
            eprintln!("read refused: {e}");
            DENIED
        }
    }
}

fn net(addr: &str) -> i32 {
    let Ok(addr) = addr.parse::<SocketAddr>() else {
        eprintln!("bad address {addr}");
        return USAGE;
    };
    match TcpStream::connect_timeout(&addr, Duration::from_secs(5)) {
        Ok(_) => {
            eprintln!("connected to {addr}");
            OK
        }
        Err(e) => {
            eprintln!("connect refused: {e}");
            DENIED
        }
    }
}

fn alloc(mib: &str) -> i32 {
    let Ok(mib) = mib.parse::<usize>() else {
        eprintln!("bad size {mib}");
        return USAGE;
    };
    let target = mib << 20;
    let mut held: Vec<Vec<u8>> = Vec::with_capacity(target / ALLOC_CHUNK_BYTES + 1);
    let mut total = 0usize;
    while total < target {
        let mut chunk = Vec::new();
        if let Err(e) = chunk.try_reserve_exact(ALLOC_CHUNK_BYTES) {
            eprintln!("allocation refused after {} MiB: {e}", total >> 20);
            return DENIED;
        }
        // Write one byte per page so the memory is resident, not just reserved.
        for page in chunk.spare_capacity_mut().iter_mut().step_by(PAGE) {
            page.write(0xA5);
        }
        held.push(chunk);
        total += ALLOC_CHUNK_BYTES;
    }
    eprintln!("holding {} MiB", total >> 20);
    OK
}

fn main() -> ExitCode {
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    let mut rest: &[OsString] = &args;
    if rest.first().is_some_and(|a| a == SANDBOX_FLAG) {
        let Some(input) = rest.get(1) else {
            return ExitCode::from(USAGE as u8);
        };
        match enter(Path::new(input)) {
            Ok(applied) => eprintln!("sandbox: {applied}"),
            Err(e) => {
                eprintln!("sandbox failed: {e}");
                return ExitCode::from(SANDBOX_FAILED as u8);
            }
        }
        rest = &rest[2..];
    }
    let code = match (rest.first().and_then(|a| a.to_str()), rest.get(1)) {
        (Some("read"), Some(path)) => read(Path::new(path)),
        (Some("net"), Some(addr)) => net(&addr.to_string_lossy()),
        (Some("alloc"), Some(mib)) => alloc(&mib.to_string_lossy()),
        _ => {
            eprintln!("usage: sandbox-probe [--sandbox <input>] (read <path> | net <ip:port> | alloc <MiB>)");
            USAGE
        }
    };
    ExitCode::from(code as u8)
}
