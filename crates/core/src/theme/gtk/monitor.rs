//! Reading the desktop's appearance and following its changes through `gdbus` (the XDG settings
//! portal) or, without a portal, `gsettings` (12-settings-theme-onboarding.md#theme). Changes are
//! pushed: one long-lived `gdbus monitor` (the portal's `SettingChanged` signal) or
//! `gsettings monitor` child prints a line per change and this reads it as it arrives. Nothing
//! polls (D-237). Both tools ship with GLib, which WebKitGTK already needs; no D-Bus crate.
//!
//! The monitor never outlives the app: [`watch`] kills and reaps it when its `stop` future
//! completes (the app's exit), and on Linux the kernel sends it SIGTERM if the app dies first
//! (`PR_SET_PDEATHSIG`, a backstop for a crash or `kill -9`).

use std::ffi::OsString;
use std::future::Future;
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, BufReader};
use tokio::process::Command;

use super::desktop::{self, APPEARANCE, Change, Desktop, INTERFACE};
use super::gvariant::MAX_TEXT_BYTES;

/// How long a one-off read (`gdbus call`, `gsettings get`) may take.
pub const READ_TIMEOUT: Duration = Duration::from_secs(3);
/// The longest monitor line kept, in bytes; longer ones are skipped.
const MAX_LINE_BYTES: usize = 64 * 1024;
/// The keys read from `gsettings`.
const KEYS: [&str; 3] = ["gtk-theme", "color-scheme", "accent-color"];

/// Where the desktop's settings came from, and so which monitor follows them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// The XDG settings portal, through `gdbus`.
    Portal,
    /// `gsettings`.
    Gsettings,
}

/// The programs used; tests point them at fakes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tools {
    /// `gdbus`.
    pub gdbus: OsString,
    /// `gsettings`.
    pub gsettings: OsString,
}

impl Default for Tools {
    fn default() -> Self {
        Self { gdbus: "gdbus".into(), gsettings: "gsettings".into() }
    }
}

/// Reads the desktop once: the portal, with `gsettings` filling a missing theme name; without a
/// portal, `gsettings` alone. `None` when neither answers.
pub async fn read(tools: &Tools) -> Option<(Desktop, Source)> {
    let namespaces = format!("['{APPEARANCE}', '{INTERFACE}']");
    let portal = output(
        &tools.gdbus,
        &[
            "call",
            "--session",
            "--dest",
            "org.freedesktop.portal.Desktop",
            "--object-path",
            "/org/freedesktop/portal/desktop",
            "--method",
            "org.freedesktop.portal.Settings.ReadAll",
            &namespaces,
        ],
    )
    .await;
    if let Some(mut desktop) = portal.as_deref().and_then(desktop::read_all) {
        if desktop.theme.is_none()
            && let Some(change) = gsettings_get(tools, "gtk-theme").await
        {
            desktop.apply(change);
        }
        return Some((desktop, Source::Portal));
    }
    let (theme, scheme, accent) =
        tokio::join!(gsettings_get(tools, KEYS[0]), gsettings_get(tools, KEYS[1]), gsettings_get(tools, KEYS[2]));
    if theme.is_none() && scheme.is_none() && accent.is_none() {
        return None;
    }
    let mut desktop = Desktop::default();
    for change in [theme, scheme, accent].into_iter().flatten() {
        desktop.apply(change);
    }
    Some((desktop, Source::Gsettings))
}

/// How a [`watch`] ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ended {
    /// The monitor exited by itself (the portal or the session went away): changes are no
    /// longer followed.
    Exited,
    /// `stop` completed: the monitor was killed and reaped.
    Stopped,
}

/// Follows the desktop's changes from `source`, calling `on_change` for each as it arrives,
/// until the monitor exits or `stop` completes. Either way the monitor is gone and reaped when
/// this returns.
pub async fn watch(
    tools: &Tools,
    source: Source,
    mut on_change: impl FnMut(Change),
    stop: impl Future<Output = ()>,
) -> std::io::Result<Ended> {
    type Parse = fn(&str) -> Option<Change>;
    let (program, args, parse): (&OsString, &[&str], Parse) = match source {
        Source::Portal => (
            &tools.gdbus,
            &[
                "monitor",
                "--session",
                "--dest",
                "org.freedesktop.portal.Desktop",
                "--object-path",
                "/org/freedesktop/portal/desktop",
            ],
            desktop::signal,
        ),
        Source::Gsettings => (&tools.gsettings, &["monitor", INTERFACE], desktop::gsettings_line),
    };
    let mut child = spawn(program, args).await?;
    let stdout = child.stdout.take().ok_or_else(|| std::io::Error::other("no stdout"))?;
    let follow = async {
        let mut lines = BufReader::new(stdout);
        let mut line = Vec::new();
        while read_line(&mut lines, &mut line).await? {
            if let Some(change) = std::str::from_utf8(&line).ok().and_then(parse) {
                on_change(change);
            }
        }
        std::io::Result::Ok(())
    };
    let ended = tokio::select! {
        read = follow => read.map(|()| Ended::Exited),
        () = stop => Ok(Ended::Stopped),
    };
    if matches!(ended, Ok(Ended::Exited)) {
        child.wait().await?;
    } else {
        // Stopped, or its output can't be read: it goes now, and is reaped (no zombie).
        child.kill().await?;
    }
    ended
}

/// One line into `buf` (without the newline); `false` at the end. A line over
/// [`MAX_LINE_BYTES`] comes back empty.
async fn read_line<R: AsyncRead + Unpin>(reader: &mut BufReader<R>, buf: &mut Vec<u8>) -> std::io::Result<bool> {
    buf.clear();
    let mut too_long = false;
    loop {
        let limit = MAX_LINE_BYTES.saturating_sub(buf.len()) as u64 + 1;
        let n = (&mut *reader).take(limit).read_until(b'\n', buf).await?;
        if n == 0 {
            if too_long {
                buf.clear();
                return Ok(true);
            }
            return Ok(!buf.is_empty());
        }
        if buf.last() == Some(&b'\n') {
            buf.pop();
            if too_long {
                buf.clear();
            }
            return Ok(true);
        }
        if buf.len() > MAX_LINE_BYTES {
            too_long = true;
            buf.clear();
        }
    }
}

async fn gsettings_get(tools: &Tools, key: &str) -> Option<Change> {
    let text = output(&tools.gsettings, &["get", INTERFACE, key]).await?;
    desktop::gsettings_value(key, &text)
}

/// A command's standard output when it succeeds within [`READ_TIMEOUT`] and prints at most
/// [`MAX_TEXT_BYTES`].
pub(crate) async fn output(program: &OsString, args: &[&str]) -> Option<String> {
    let run = async {
        let mut child = spawn(program, args).await.ok()?;
        let mut out = Vec::new();
        child.stdout.take()?.take(MAX_TEXT_BYTES as u64 + 1).read_to_end(&mut out).await.ok()?;
        let ok = child.wait().await.ok()?.success();
        (ok && out.len() <= MAX_TEXT_BYTES).then(|| String::from_utf8_lossy(&out).into_owned())
    };
    tokio::time::timeout(READ_TIMEOUT, run).await.ok().flatten()
}

/// Starts `program`. A program file still open for writing somewhere (a package update replacing
/// it, or another thread's child that inherited the descriptor and hasn't exec'd yet) fails with
/// "text file busy" for a moment: try again a few times, as cargo does.
async fn spawn(program: &OsString, args: &[&str]) -> std::io::Result<tokio::process::Child> {
    let mut tries = 0;
    loop {
        match command(program, args).spawn() {
            Err(e) if e.kind() == std::io::ErrorKind::ExecutableFileBusy && tries < 5 => {
                tries += 1;
                tokio::time::sleep(Duration::from_millis(10 * tries)).await;
            }
            other => return other,
        }
    }
}

fn command(program: &OsString, args: &[&str]) -> Command {
    let mut cmd = Command::new(program);
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    #[cfg(target_os = "linux")]
    die_with_parent(&mut cmd);
    // A console program started from a GUI app would open a console window: CREATE_NO_WINDOW.
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    cmd
}

/// Has the kernel send the child SIGTERM when its parent goes, however it goes. Linux sends it
/// when the thread that spawned the child exits: callers spawn from the async runtime's worker
/// threads, which live as long as the app.
#[cfg(target_os = "linux")]
fn die_with_parent(cmd: &mut Command) {
    let parent = std::process::id() as libc::pid_t;
    // SAFETY: the closure runs in the child between fork and exec. It calls only prctl and
    // getppid, both async-signal-safe, and allocates nothing (raw OS errors carry no heap data).
    unsafe {
        cmd.pre_exec(move || {
            if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            // The parent died before prctl: nothing would send the signal any more.
            if libc::getppid() != parent {
                return Err(std::io::Error::from_raw_os_error(libc::ESRCH));
            }
            Ok(())
        });
    }
}

#[cfg(test)]
#[path = "monitor_tests.rs"]
mod tests;
