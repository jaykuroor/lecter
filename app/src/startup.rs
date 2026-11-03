//! Startup timing (`14-quality.md#performance-budgets`, `cold_open_ms`): the app writes one
//! `startup <phase> <ms>` line to stderr per phase, in milliseconds since its process started, the
//! first time each phase happens. The shell sees the window and the page load start; the UI reports
//! its two paints through `app_mark_startup` (`ipc/app.rs`), after it painted.

use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, SystemTime};

/// A startup phase, in the order they normally happen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    /// The main window exists (Tauri built it from `tauri.conf.json`).
    WindowCreated,
    /// The main webview started loading the UI.
    PageLoadStarted,
    /// The UI's frame (headerbar, rail, panels) is on screen.
    ShellFirstPaint,
    /// The first lecture opened this session is on screen in the buffer.
    BufferFirstPaint,
}

impl Phase {
    const ALL: [Phase; 4] =
        [Phase::WindowCreated, Phase::PageLoadStarted, Phase::ShellFirstPaint, Phase::BufferFirstPaint];

    /// The phase's name in the log line.
    pub fn name(self) -> &'static str {
        match self {
            Phase::WindowCreated => "window-created",
            Phase::PageLoadStarted => "page-load-started",
            Phase::ShellFirstPaint => "shell-first-paint",
            Phase::BufferFirstPaint => "buffer-first-paint",
        }
    }

    fn index(self) -> usize {
        Phase::ALL.iter().position(|p| *p == self).unwrap_or(0)
    }
}

/// The log line for `phase`, `since` after the process started: whole milliseconds, rounded.
pub fn line(phase: Phase, since: Duration) -> String {
    format!("startup {} {}", phase.name(), (since.as_secs_f64() * 1000.0).round() as u64)
}

/// Where the lines go: stderr in the app, a buffer in tests.
type Sink = dyn Fn(&str) + Send + Sync;

/// The process's start time and the phases logged so far. Cheap to clone (shared).
#[derive(Clone)]
pub struct Startup {
    started_at: SystemTime,
    logged: Arc<Mutex<[bool; 4]>>,
    sink: Arc<Sink>,
}

impl Startup {
    /// Timing from `started_at`, writing each line to `sink`.
    pub fn new(started_at: SystemTime, sink: impl Fn(&str) + Send + Sync + 'static) -> Self {
        Self { started_at, logged: Arc::new(Mutex::new([false; 4])), sink: Arc::new(sink) }
    }

    /// Timing from the OS's record of when this process started, writing to stderr. Called first
    /// thing in `main`.
    pub fn from_process_start() -> Self {
        let now = SystemTime::now();
        let started_at = process_age().and_then(|age| now.checked_sub(age)).unwrap_or(now);
        Self::new(started_at, |l| eprintln!("{l}"))
    }

    /// Logs `phase` as happening at `at`, unless it was logged before. Returns whether it logged.
    /// A time before the process started counts as 0 ms (the start time is known to 10 ms).
    pub fn mark(&self, phase: Phase, at: SystemTime) -> bool {
        {
            let mut logged = self.logged.lock().unwrap_or_else(PoisonError::into_inner);
            let seen = &mut logged[phase.index()];
            if *seen {
                return false;
            }
            *seen = true;
        }
        let since = at.duration_since(self.started_at).unwrap_or(Duration::ZERO);
        (self.sink)(&line(phase, since));
        true
    }

    /// Logs `phase` as happening now, unless it was logged before.
    pub fn mark_now(&self, phase: Phase) -> bool {
        self.mark(phase, SystemTime::now())
    }
}

/// How long ago this process started, from the OS. `None` where it can't be read; the caller then
/// counts from `main` (which leaves out the time to load the program and its libraries).
fn process_age() -> Option<Duration> {
    #[cfg(target_os = "linux")]
    {
        #[allow(clippy::disallowed_methods, reason = "two small procfs reads in main, before any async runtime exists")]
        let read = |p: &str| std::fs::read_to_string(p).ok();
        age_from_procfs(&read("/proc/self/stat")?, &read("/proc/uptime")?, USER_HZ)
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

/// Linux reports times in `/proc/<pid>/stat` in USER_HZ ticks, which the kernel ABI fixes at 100.
#[cfg(any(target_os = "linux", test))]
const USER_HZ: u64 = 100;

/// The process's age from `/proc/self/stat` (field 22, `starttime`: ticks after boot) and
/// `/proc/uptime` (seconds since boot), both on the boot-time clock. `None` if either is malformed
/// or the start lies after now.
#[cfg(any(target_os = "linux", test))]
fn age_from_procfs(stat: &str, uptime: &str, hz: u64) -> Option<Duration> {
    // The command name (field 2) is in parentheses and may hold spaces or ')': fields resume after
    // the last ')'. Field 3 is the first one after it, so field 22 is the 20th.
    let rest = &stat[stat.rfind(')')? + 1..];
    let start_ticks: u64 = rest.split_whitespace().nth(19)?.parse().ok()?;
    let up = Duration::try_from_secs_f64(uptime.split_whitespace().next()?.parse().ok()?).ok()?;
    if hz == 0 {
        return None;
    }
    let started = Duration::from_secs(start_ticks / hz) + Duration::from_nanos((start_ticks % hz) * 1_000_000_000 / hz);
    up.checked_sub(started)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A `Startup` from `t0` that collects its lines.
    fn collecting(t0: SystemTime) -> (Startup, Arc<Mutex<Vec<String>>>) {
        let lines = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&lines);
        let s = Startup::new(t0, move |l| sink.lock().unwrap().push(l.to_owned()));
        (s, lines)
    }

    #[test]
    fn each_phase_logs_one_line_in_ms_since_the_process_started() {
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_800_000_000);
        let (s, lines) = collecting(t0);
        assert!(s.mark(Phase::WindowCreated, t0 + Duration::from_millis(41)));
        assert!(s.mark(Phase::PageLoadStarted, t0 + Duration::from_micros(97_600)));
        assert!(s.mark(Phase::ShellFirstPaint, t0 + Duration::from_micros(212_400)));
        assert!(s.mark(Phase::BufferFirstPaint, t0 + Duration::from_secs(3)));
        assert_eq!(
            *lines.lock().unwrap(),
            [
                "startup window-created 41",
                "startup page-load-started 98",
                "startup shell-first-paint 212",
                "startup buffer-first-paint 3000"
            ]
        );
    }

    #[test]
    fn a_phase_is_logged_only_the_first_time() {
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_800_000_000);
        let (s, lines) = collecting(t0);
        assert!(s.mark(Phase::BufferFirstPaint, t0 + Duration::from_millis(500)));
        // A second lecture, a reload: not the first paint any more.
        assert!(!s.mark(Phase::BufferFirstPaint, t0 + Duration::from_millis(900)));
        assert!(s.mark(Phase::ShellFirstPaint, t0 + Duration::from_millis(300)));
        assert!(!s.mark(Phase::ShellFirstPaint, t0 + Duration::from_millis(301)));
        assert_eq!(*lines.lock().unwrap(), ["startup buffer-first-paint 500", "startup shell-first-paint 300"]);
    }

    #[test]
    fn clones_share_what_was_logged() {
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_800_000_000);
        let (s, lines) = collecting(t0);
        let other = s.clone();
        assert!(s.mark(Phase::WindowCreated, t0));
        assert!(!other.mark(Phase::WindowCreated, t0 + Duration::from_millis(5)));
        assert_eq!(lines.lock().unwrap().len(), 1);
    }

    #[test]
    fn a_time_before_the_start_counts_as_zero() {
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_800_000_000);
        let (s, lines) = collecting(t0);
        s.mark(Phase::WindowCreated, t0 - Duration::from_millis(4));
        assert_eq!(*lines.lock().unwrap(), ["startup window-created 0"]);
    }

    #[test]
    fn rounds_to_the_nearest_millisecond() {
        assert_eq!(line(Phase::ShellFirstPaint, Duration::from_micros(599_499)), "startup shell-first-paint 599");
        assert_eq!(line(Phase::ShellFirstPaint, Duration::from_micros(599_500)), "startup shell-first-paint 600");
    }

    /// A real `/proc/<pid>/stat` line shape, with a command name holding a space and a ')'.
    fn stat(comm: &str, starttime: u64) -> String {
        format!(
            "4242 ({comm}) S 1 4242 4242 0 -1 4194560 3012 0 0 0 12 4 0 0 20 0 9 0 {starttime} 1188 41 18446744073709551615"
        )
    }

    #[test]
    fn the_process_age_is_uptime_minus_the_start_tick() {
        // Started 12345.67 s after boot; it is now 12346.89 s after boot: 1.22 s old.
        let age = age_from_procfs(&stat("lecter-app", 1_234_567), "12346.89 98765.43\n", 100);
        assert_eq!(age, Some(Duration::from_millis(1220)));
    }

    #[test]
    fn the_command_name_may_hold_spaces_and_parentheses() {
        let age = age_from_procfs(&stat("we (ird) name", 1_000), "11.50 0.00", 100);
        assert_eq!(age, Some(Duration::from_millis(1500)));
    }

    #[test]
    fn other_tick_rates_are_honoured() {
        assert_eq!(age_from_procfs(&stat("x", 2_500), "11.0 0", 250), Some(Duration::from_secs(1)));
        assert_eq!(age_from_procfs(&stat("x", 1), "1.0 0", 0), None);
    }

    #[test]
    fn malformed_procfs_text_gives_no_age() {
        assert_eq!(age_from_procfs("4242 lecter-app S 1", "5.0 0", 100), None, "no ')'");
        assert_eq!(age_from_procfs("4242 (x) S 1 2 3", "5.0 0", 100), None, "too few fields");
        assert_eq!(age_from_procfs(&stat("x", 100), "", 100), None, "no uptime");
        assert_eq!(age_from_procfs(&stat("x", 100), "soon 0", 100), None, "uptime not a number");
        assert_eq!(age_from_procfs(&stat("x", 100), "-3.0 0", 100), None, "negative uptime");
        assert_eq!(age_from_procfs(&stat("x", 900), "5.0 0", 100), None, "started after now");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn this_process_started_before_now_and_recently() {
        let age = process_age().unwrap();
        // The test binary has been running for less than its own run time limit.
        assert!(age < Duration::from_secs(600), "{age:?}");
        let s = Startup::from_process_start();
        assert!(s.started_at <= SystemTime::now());
    }
}
