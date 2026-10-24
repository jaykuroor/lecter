//! The child process the tests sandbox. Usage and exit codes: `lecter_spike_os_sandbox::probe`.
#![allow(
    clippy::disallowed_methods,
    reason = "a synchronous child process; blocking std::fs/std::net calls are the probes"
)]

use std::ffi::OsString;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::mpsc;
use std::time::Duration;

use lecter_spike_os_sandbox::enter;
use lecter_spike_os_sandbox::probe::{
    ALLOC_CHUNK_BYTES, DENIED, INPUT_HANDLE_FLAG, OK, SANDBOX_FAILED, SANDBOX_FLAG, THREAD_FIRST_FLAG, USAGE,
};

/// The smallest page size of the three OSes.
const PAGE: usize = 4096;

/// Where `read-input` reads from.
enum Input {
    None,
    Path(PathBuf),
    #[cfg_attr(not(windows), allow(dead_code))]
    Handle(usize),
}

fn report(what: &str, r: std::io::Result<usize>) -> i32 {
    match r {
        Ok(n) => {
            eprintln!("{what}: {n} bytes");
            OK
        }
        Err(e) => {
            eprintln!("{what} refused: {e}");
            DENIED
        }
    }
}

fn read(path: &Path) -> i32 {
    report("read", std::fs::read(path).map(|b| b.len()))
}

fn read_input(input: &Input) -> i32 {
    match input {
        Input::None => USAGE,
        Input::Path(p) => report("read-input", std::fs::read(p).map(|b| b.len())),
        #[cfg(windows)]
        Input::Handle(h) => {
            use std::io::Read;
            use std::os::windows::io::FromRawHandle;
            // SAFETY: the parent passed this handle to us through PROC_THREAD_ATTRIBUTE_HANDLE_LIST.
            let mut file = unsafe { std::fs::File::from_raw_handle(*h as std::os::windows::io::RawHandle) };
            let mut buf = Vec::new();
            report("read-input", file.read_to_end(&mut buf))
        }
        #[cfg(not(windows))]
        Input::Handle(_) => USAGE,
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

fn alloc(mib: usize) -> i32 {
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

/// Starts a second process that allocates `mib` while this one does too.
#[cfg(unix)]
fn spawn_alloc(mib: usize) -> i32 {
    // SAFETY: this process is single-threaded here; the child only allocates and _exits.
    let pid = unsafe { libc::fork() };
    if pid < 0 {
        eprintln!("fork refused: {}", std::io::Error::last_os_error());
        return DENIED;
    }
    if pid == 0 {
        let code = alloc(mib);
        // SAFETY: leave the forked child without running the parent's destructors.
        unsafe { libc::_exit(code) };
    }
    let mine = alloc(mib);
    let mut status = 0;
    // SAFETY: waiting for our own child.
    unsafe { libc::waitpid(pid, &mut status, 0) };
    let theirs = if libc::WIFEXITED(status) { libc::WEXITSTATUS(status) } else { DENIED };
    eprintln!("two processes: parent {mine}, child {theirs}");
    if mine == OK && theirs == OK { OK } else { DENIED }
}

#[cfg(windows)]
fn spawn_alloc(mib: usize) -> i32 {
    let exe = match std::env::current_exe() {
        Ok(exe) => exe,
        Err(e) => {
            eprintln!("current_exe: {e}");
            return USAGE;
        }
    };
    match std::process::Command::new(exe).args(["alloc", &mib.to_string()]).spawn() {
        Err(e) => {
            eprintln!("spawn refused: {e}");
            DENIED
        }
        Ok(mut child) => {
            let mine = alloc(mib);
            let theirs = child.wait().ok().and_then(|s| s.code()).unwrap_or(DENIED);
            eprintln!("two processes: parent {mine}, child {theirs}");
            if mine == OK && theirs == OK { OK } else { DENIED }
        }
    }
}

fn thread() -> i32 {
    match std::thread::Builder::new().spawn(|| 7).map(|h| h.join()) {
        Ok(Ok(7)) => {
            eprintln!("thread ran");
            OK
        }
        _ => {
            eprintln!("thread refused");
            DENIED
        }
    }
}

#[cfg(unix)]
fn use_fd(fd: i32) -> i32 {
    // SAFETY: writes one byte from a valid buffer; an invalid fd just fails with EBADF.
    let n = unsafe { libc::write(fd, b"x".as_ptr().cast(), 1) };
    report("use-fd", if n == 1 { Ok(1) } else { Err(std::io::Error::last_os_error()) })
}

fn main() -> ExitCode {
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    let mut rest: &[OsString] = &args;
    let mut input = Input::None;
    // Kept alive until exit: a thread that exists before the sandbox (--thread-first).
    let mut _early_thread: Option<mpsc::Sender<()>> = None;
    if rest.first().is_some_and(|a| a == THREAD_FIRST_FLAG) {
        let (tx, rx) = mpsc::channel::<()>();
        if std::thread::Builder::new().spawn(move || rx.recv()).is_err() {
            return ExitCode::from(USAGE as u8);
        }
        _early_thread = Some(tx);
        rest = &rest[1..];
    }
    if rest.first().is_some_and(|a| a == SANDBOX_FLAG) {
        let Some(path) = rest.get(1) else {
            return ExitCode::from(USAGE as u8);
        };
        match enter(Path::new(path)) {
            Ok(applied) => eprintln!("sandbox: {applied}"),
            Err(e) => {
                eprintln!("sandbox failed: {e}");
                return ExitCode::from(SANDBOX_FAILED as u8);
            }
        }
        input = Input::Path(PathBuf::from(path));
        rest = &rest[2..];
        if rest.first().is_some_and(|a| a == INPUT_HANDLE_FLAG) {
            match rest.get(1).and_then(|h| h.to_str()?.parse::<usize>().ok()) {
                Some(h) => input = Input::Handle(h),
                None => return ExitCode::from(USAGE as u8),
            }
            rest = &rest[2..];
        }
    }
    let probe = rest.first().and_then(|a| a.to_str());
    let arg = rest.get(1).map(|a| a.to_string_lossy().into_owned());
    let number = arg.as_deref().and_then(|a| a.parse::<usize>().ok());
    let code = match (probe, arg.as_deref(), number) {
        (Some("read"), Some(path), _) => read(Path::new(path)),
        (Some("read-input"), _, _) => read_input(&input),
        (Some("net"), Some(addr), _) => net(addr),
        (Some("alloc"), _, Some(mib)) => alloc(mib),
        (Some("spawn-alloc"), _, Some(mib)) => spawn_alloc(mib),
        (Some("thread"), _, _) => thread(),
        #[cfg(unix)]
        (Some("use-fd"), _, Some(fd)) => use_fd(fd as i32),
        _ => {
            eprintln!("usage: see lecter_spike_os_sandbox::probe");
            USAGE
        }
    };
    ExitCode::from(code as u8)
}
