#![allow(clippy::disallowed_methods, reason = "tests build fake tools on plain test threads")]

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use super::*;
use crate::testenv::TestEnv;
use crate::theme::gtk::color::Rgba;
use crate::theme::gtk::desktop::{Change, Desktop};
use crate::theme::gtk::fixture;
use crate::theme::gtk::folders::ThemeDirs;
use crate::theme::gtk::follow::Follower;
use crate::theme::gtk::tokens::Scheme;

const READ_ALL: &str = "({'org.freedesktop.appearance': {'color-scheme': <uint32 1>, 'accent-color': <(1.0, 0.0, 0.0)>}, \
                        'org.gnome.desktop.interface': {'gtk-theme': <'Adwaitish'>}},)";

const SIGNAL: &str = "/org/freedesktop/portal/desktop: org.freedesktop.portal.Settings.SettingChanged";

/// An executable shell script at `dir/name`.
fn tool(dir: &Path, name: &str, body: &str) -> OsString {
    let path = dir.join(name);
    std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    path.into_os_string()
}

fn gsettings_answers(dir: &Path) -> OsString {
    tool(
        dir,
        "gsettings",
        "[ \"$1 $2\" = \"get org.gnome.desktop.interface\" ] || exit 2\n\
         case \"$3\" in gtk-theme) echo \"'Greyish'\";; color-scheme) echo \"'prefer-light'\";; \
         accent-color) echo \"'red'\";; *) exit 1;; esac",
    )
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap()
}

#[test]
fn reads_the_portal_first() {
    let env = TestEnv::new().unwrap();
    let tools = Tools {
        gdbus: tool(env.home(), "gdbus", &format!("[ \"$1\" = call ] || exit 2\necho \"{READ_ALL}\"")),
        gsettings: gsettings_answers(env.home()),
    };
    let (desktop, source) = runtime().block_on(read(&tools)).unwrap();
    assert_eq!(source, Source::Portal);
    assert_eq!(
        desktop,
        Desktop { theme: Some("Adwaitish".into()), scheme: Some(Scheme::Dark), accent: Some(Rgba::from_hex(0xff0000)) }
    );
}

#[test]
fn gsettings_fills_a_theme_name_the_portal_lacks() {
    let env = TestEnv::new().unwrap();
    let kde = "({'org.freedesktop.appearance': {'color-scheme': <uint32 2>}},)";
    let tools = Tools {
        gdbus: tool(env.home(), "gdbus", &format!("echo \"{kde}\"")),
        gsettings: gsettings_answers(env.home()),
    };
    let (desktop, source) = runtime().block_on(read(&tools)).unwrap();
    assert_eq!(source, Source::Portal);
    assert_eq!(desktop, Desktop { theme: Some("Greyish".into()), scheme: Some(Scheme::Light), accent: None });
}

#[test]
fn without_a_portal_gsettings_answers_alone() {
    let env = TestEnv::new().unwrap();
    let tools = Tools {
        gdbus: tool(
            env.home(),
            "gdbus",
            "echo 'Error: GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown' >&2; exit 1",
        ),
        gsettings: gsettings_answers(env.home()),
    };
    let (desktop, source) = runtime().block_on(read(&tools)).unwrap();
    assert_eq!(source, Source::Gsettings);
    assert_eq!(
        desktop,
        Desktop { theme: Some("Greyish".into()), scheme: Some(Scheme::Light), accent: Some(Rgba::from_hex(0xe62d42)) }
    );
}

#[test]
fn neither_tool_answering_reads_nothing() {
    let env = TestEnv::new().unwrap();
    let missing = Tools { gdbus: env.home().join("nope-gdbus").into(), gsettings: env.home().join("nope").into() };
    assert_eq!(runtime().block_on(read(&missing)), None);
    let failing = Tools {
        gdbus: tool(env.home(), "gdbus", "exit 1"),
        gsettings: tool(env.home(), "gsettings", "echo \"'Greyish'\"; exit 1"),
    };
    assert_eq!(runtime().block_on(read(&failing)), None, "a failing command's output is not used");
}

#[test]
fn an_answer_over_the_size_cap_is_refused() {
    let env = TestEnv::new().unwrap();
    let big = env.home().join("big.txt");
    let mut answer = String::from("({'org.freedesktop.appearance': {'color-scheme': <uint32 1>}},)");
    answer.push_str(&" ".repeat(MAX_TEXT_BYTES));
    std::fs::write(&big, answer).unwrap();
    let tools = Tools {
        gdbus: tool(env.home(), "gdbus", &format!("cat '{}'", big.display())),
        gsettings: tool(env.home(), "gsettings", "exit 1"),
    };
    assert_eq!(runtime().block_on(read(&tools)), None);
}

#[test]
fn watching_the_portal_reports_each_followed_setting() {
    let env = TestEnv::new().unwrap();
    let lines = [
        "Monitoring signals on object /org/freedesktop/portal/desktop owned by org.freedesktop.portal.Desktop"
            .to_owned(),
        format!("{SIGNAL} ('org.gnome.desktop.interface', 'gtk-theme', <'Nightish'>)"),
        format!("{SIGNAL} ('org.gnome.desktop.interface', 'font-name', <'Sans 11'>)"),
        format!("{SIGNAL} ('org.freedesktop.appearance', 'color-scheme', <uint32 1>)"),
        format!("{SIGNAL} ('org.gnome.desktop.interface', 'gtk-theme', <'{}'>)", "x".repeat(70_000)),
        format!("{SIGNAL} ('org.freedesktop.appearance', 'accent-color', <(0.0, 0.0, 1.0)>)"),
    ];
    let script = env.home().join("signals.txt");
    std::fs::write(&script, lines.join("\n")).unwrap();
    let tools = Tools {
        gdbus: tool(env.home(), "gdbus", &format!("[ \"$1\" = monitor ] || exit 2\ncat '{}'", script.display())),
        gsettings: OsString::from("unused"),
    };
    let mut seen = Vec::new();
    let ended = runtime().block_on(watch(&tools, Source::Portal, |c| seen.push(c), std::future::pending())).unwrap();
    assert_eq!(ended, Ended::Exited);
    assert_eq!(
        seen,
        [
            Change::Theme(Some("Nightish".into())),
            Change::Scheme(Some(Scheme::Dark)),
            Change::Accent(Some(Rgba::from_hex(0x0000ff))),
        ]
    );
}

#[test]
fn watching_gsettings_reports_each_followed_key() {
    let env = TestEnv::new().unwrap();
    let tools = Tools {
        gdbus: OsString::from("unused"),
        gsettings: tool(
            env.home(),
            "gsettings",
            "[ \"$1 $2\" = \"monitor org.gnome.desktop.interface\" ] || exit 2\n\
             printf \"gtk-theme: 'Greyish'\\ncursor-size: 32\\ncolor-scheme: 'prefer-dark'\\n\"",
        ),
    };
    let mut seen = Vec::new();
    let ended = runtime().block_on(watch(&tools, Source::Gsettings, |c| seen.push(c), std::future::pending()));
    assert_eq!(ended.unwrap(), Ended::Exited);
    assert_eq!(seen, [Change::Theme(Some("Greyish".into())), Change::Scheme(Some(Scheme::Dark))]);
}

#[test]
fn watching_a_missing_tool_is_an_error() {
    let tools = Tools { gdbus: OsString::from("/nonexistent/gdbus"), gsettings: OsString::from("unused") };
    assert!(runtime().block_on(watch(&tools, Source::Portal, |_| {}, std::future::pending())).is_err());
}

#[test]
fn read_line_splits_lines_and_skips_overlong_ones() {
    let long = "y".repeat(MAX_LINE_BYTES + 10);
    let fits = "z".repeat(MAX_LINE_BYTES);
    let text = format!("one\n{long}\n{fits}\nlast");
    let mut reader = BufReader::new(text.as_bytes());
    let mut buf = Vec::new();
    let mut got = Vec::new();
    runtime().block_on(async {
        while read_line(&mut reader, &mut buf).await.unwrap() {
            got.push(String::from_utf8(buf.clone()).unwrap());
        }
    });
    assert_eq!(got, ["one".to_owned(), String::new(), fits, "last".to_owned()]);
    let mut overlong_at_end = BufReader::new(long.as_bytes());
    runtime().block_on(async {
        assert!(read_line(&mut overlong_at_end, &mut buf).await.unwrap());
        assert!(buf.is_empty());
        assert!(!read_line(&mut overlong_at_end, &mut buf).await.unwrap());
    });
}

fn mkfifo(path: &PathBuf) {
    let status = std::process::Command::new("mkfifo").arg(path).status().unwrap();
    assert!(status.success());
}

/// D-237: the time from a portal `SettingChanged` signal to the tokens the UI applies, through a
/// fake portal process (a FIFO the test writes signals into). Prints median and p95 with
/// `--nocapture`.
#[test]
fn a_portal_change_reaches_the_tokens_within_milliseconds() {
    let env = TestEnv::new().unwrap();
    let fifo = env.home().join("portal.fifo");
    mkfifo(&fifo);
    let tools = Tools {
        gdbus: tool(env.home(), "gdbus", &format!("exec cat '{}'", fifo.display())),
        gsettings: OsString::from("unused"),
    };
    let rounds = 200;
    let (ack, acked) = mpsc::channel::<Instant>();
    let writer = std::thread::spawn({
        let fifo = fifo.clone();
        move || {
            let mut pipe = std::fs::OpenOptions::new().write(true).open(&fifo).unwrap();
            let themes = ["Adwaitish", "Greyish", "Nightish"];
            let mut latencies = Vec::new();
            for i in 0..rounds {
                let line = if i % 2 == 0 {
                    format!("{SIGNAL} ('org.gnome.desktop.interface', 'gtk-theme', <'{}'>)\n", themes[i % 3])
                } else {
                    format!("{SIGNAL} ('org.freedesktop.appearance', 'color-scheme', <uint32 {}>)\n", i % 3)
                };
                let sent = Instant::now();
                pipe.write_all(line.as_bytes()).unwrap();
                pipe.flush().unwrap();
                let applied = acked.recv_timeout(Duration::from_secs(10)).unwrap();
                latencies.push(applied - sent);
            }
            latencies
        }
    });
    let mut follower = Follower::new(ThemeDirs::new(vec![fixture("")], vec![]));
    let mut applied = 0;
    let on_change = |change| {
        follower.change(change);
        let update = follower.update();
        assert!(update.theme.is_some());
        applied += 1;
        ack.send(Instant::now()).unwrap();
    };
    runtime().block_on(watch(&tools, Source::Portal, on_change, std::future::pending())).unwrap();
    let mut latencies = writer.join().unwrap();
    assert_eq!(applied, rounds);
    latencies.sort();
    let median = latencies[rounds / 2];
    let p95 = latencies[rounds * 95 / 100];
    println!("portal change → tokens: median {median:?}, p95 {p95:?}, parses {}", follower.reads());
    // Three themes, each parsed once.
    assert_eq!(follower.reads(), 3);
    assert!(p95 < Duration::from_millis(50), "p95 {p95:?}");
}

/// A fake monitor that writes its pid to `pid_file`, then waits and prints nothing.
#[cfg(target_os = "linux")]
fn sleeper(dir: &Path, pid_file: &Path) -> OsString {
    let file = pid_file.display();
    tool(dir, "gdbus", &format!("echo $$ > '{file}.tmp' && mv '{file}.tmp' '{file}'\nexec sleep 600"))
}

/// The pid written to `file`, once it is there (deadline 10 s).
#[cfg(target_os = "linux")]
async fn pid_in(file: &Path) -> libc::pid_t {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(pid) = std::fs::read_to_string(file).ok().and_then(|t| t.trim().parse().ok()) {
            return pid;
        }
        assert!(Instant::now() < deadline, "no pid in {}", file.display());
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

/// A process's state letter from `/proc` (`S` sleeping, `Z` zombie, …); `None` once it is reaped.
#[cfg(target_os = "linux")]
fn state(pid: libc::pid_t) -> Option<char> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    stat.rsplit_once(')')?.1.trim_start().chars().next()
}

/// Kills and reaps `pid` when the test ends, passed or failed.
#[cfg(target_os = "linux")]
struct Reap(libc::pid_t);

#[cfg(target_os = "linux")]
impl Drop for Reap {
    fn drop(&mut self) {
        // SAFETY: plain syscalls on a child of this process; a null status pointer is allowed.
        unsafe {
            libc::kill(self.0, libc::SIGKILL);
            libc::waitpid(self.0, std::ptr::null_mut(), 0);
        }
    }
}

/// The app's exit stops the watch: the monitor is killed and reaped before `watch` returns, so
/// no `gdbus monitor` outlives the app.
#[cfg(target_os = "linux")]
#[test]
fn stopping_a_watch_kills_and_reaps_the_monitor() {
    let env = TestEnv::new().unwrap();
    let pid_file = env.home().join("monitor.pid");
    let tools = Tools { gdbus: sleeper(env.home(), &pid_file), gsettings: OsString::from("unused") };
    let mut pid = 0;
    let stop = async { pid = pid_in(&pid_file).await };
    let ended = runtime().block_on(watch(&tools, Source::Portal, |_| {}, stop)).unwrap();
    assert_eq!(ended, Ended::Stopped);
    assert!(pid > 0);
    assert_eq!(state(pid), None, "monitor {pid} is still there");
}

/// The backstop for a crash or `kill -9`: when the thread that started a monitor goes without
/// stopping it, the kernel ends the monitor (PR_SET_PDEATHSIG).
#[cfg(target_os = "linux")]
#[test]
fn the_monitor_dies_with_the_thread_that_started_it() {
    let env = TestEnv::new().unwrap();
    let program = sleeper(env.home(), &env.home().join("orphan.pid"));
    let pid = std::thread::spawn(move || {
        runtime().block_on(async {
            let child = spawn(&program, &[]).await.unwrap();
            let pid = libc::pid_t::try_from(child.id().unwrap()).unwrap();
            // As if the app died: nothing kills the child or drops its handle.
            std::mem::forget(child);
            pid
        })
    })
    .join()
    .unwrap();
    let _reap = Reap(pid);
    let deadline = Instant::now() + Duration::from_secs(10);
    while !matches!(state(pid), None | Some('Z')) {
        assert!(Instant::now() < deadline, "monitor {pid} outlived its parent thread: {:?}", state(pid));
        std::thread::sleep(Duration::from_millis(5));
    }
}
