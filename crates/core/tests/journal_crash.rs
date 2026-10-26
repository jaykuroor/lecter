//! F-021.3, the crash test (`14-quality.md` `crash_loss_ms` ≤ 250 ms): a child process types into
//! a lecture through a save session, in bursts with pauses long enough for saves, and is killed
//! (SIGKILL on Unix, TerminateProcess on Windows) mid-burst. Reopening the lecture must give the
//! typed text minus at most the last 250 ms.
//!
//! The child is this test binary run again on the `typist` test, which types until killed when
//! `CRASH_TYPIST` names a course folder; without it, `typist` types one short session in-process.

#![allow(clippy::disallowed_methods, reason = "test processes build fixtures and pace typing on plain threads")]
#![allow(clippy::unwrap_used, reason = "integration test")]

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use lecter_core::save::{Edit, Session};
use lecter_core::testenv::TestEnv;

const CRASH_TYPIST: &str = "CRASH_TYPIST";
const REL: &str = "lectures/l07.md";
const LECTURE: &str = "---\nlecter: 1\n---\n\n::: {.slide #s1 n=1}\n## Covariance\n\n[Covariance measures how two variables move together.]{#s1b1}\n\n:::\n";
/// Typing goes in after "Covariance" in the block (UTF-16 = byte offsets here: ASCII).
const AT: &str = "[Covariance";
const SENTENCE: &str = " so a positive value means they rise together, and é counts twice in bytes.";
/// Keystrokes per burst, the pause between them (longer than the 1 s save debounce) and the
/// pace inside a burst (faster than anyone types).
const BURST: usize = 120;
const PAUSE: Duration = Duration::from_millis(1300);
const PACE: Duration = Duration::from_millis(4);
/// The budget: kill -9 loses at most this much typing.
const LOSS_BUDGET: Duration = Duration::from_millis(250);

/// The first `n` typed characters.
fn typed(n: usize) -> String {
    SENTENCE.chars().cycle().take(n).collect()
}

fn insert_at() -> usize {
    LECTURE.find(AT).unwrap() + AT.len()
}

fn course(env: &TestEnv) -> PathBuf {
    let dir = env.home().join("STAT311");
    std::fs::create_dir_all(dir.join("lectures")).unwrap();
    std::fs::write(dir.join(REL), LECTURE).unwrap();
    std::fs::canonicalize(dir).unwrap()
}

/// Types `count` characters (forever if `None`) into the lecture, one edit per keystroke, printing
/// `typed <n>` once keystroke n is acknowledged (in the journal).
fn type_into(dir: &Path, count: Option<usize>) -> Session {
    let (session, _) = Session::open(dir, REL).unwrap();
    let start = u32::try_from(insert_at()).unwrap();
    // UTF-16 position of the next keystroke.
    let mut pos = start;
    for (i, ch) in SENTENCE.chars().cycle().take(count.unwrap_or(usize::MAX)).enumerate() {
        if i > 0 && i % BURST == 0 {
            std::thread::sleep(PAUSE);
        }
        session.apply(vec![Edit { from: pos, to: pos, text: ch.to_string() }]).unwrap();
        pos += u32::try_from(ch.len_utf16()).unwrap();
        println!("typed {}", i + 1);
        std::thread::sleep(PACE);
    }
    session
}

/// The child: types until killed. In-process (no `CRASH_TYPIST`): types two bursts, closes, and
/// the file holds exactly what was typed.
#[test]
fn typist() {
    if let Some(dir) = std::env::var_os(CRASH_TYPIST) {
        type_into(Path::new(&dir), None);
        return;
    }
    let env = TestEnv::new().unwrap();
    let dir = course(&env);
    type_into(&dir, Some(BURST + 10)).close().unwrap();
    let mut want = LECTURE.to_owned();
    want.insert_str(insert_at(), &typed(BURST + 10));
    assert_eq!(std::fs::read_to_string(dir.join(REL)).unwrap(), want);
}

/// How many typed characters `text` holds, if it is the lecture with a prefix of the typing in place.
fn recovered_chars(text: &str) -> Option<usize> {
    let at = insert_at();
    let middle = text.strip_prefix(&LECTURE[..at])?.strip_suffix(&LECTURE[at..])?;
    let n = middle.chars().count();
    (middle == typed(n)).then_some(n)
}

/// One crash: kill the typist once it has acknowledged `kill_after` keystrokes. Returns the
/// keystrokes acknowledged, those recovered, and how long before the kill the first lost one was
/// acknowledged (zero if none was lost).
fn crash_once(kill_after: usize) -> (usize, usize, Duration) {
    let env = TestEnv::new().unwrap();
    let dir = course(&env);
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "typist", "--nocapture", "--test-threads=1"])
        .env(CRASH_TYPIST, &dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let stdout = child.stdout.take().unwrap();
    let (tx, acks) = mpsc::channel::<(usize, Instant)>();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(n) = line.strip_prefix("typed ").and_then(|n| n.parse().ok()) {
                let _ = tx.send((n, Instant::now()));
            }
        }
    });
    let mut seen: Vec<(usize, Instant)> = Vec::new();
    while seen.last().is_none_or(|&(n, _)| n < kill_after) {
        seen.push(acks.recv_timeout(Duration::from_secs(30)).expect("the typist stopped acknowledging"));
    }
    let killed_at = Instant::now();
    child.kill().unwrap();
    child.wait().unwrap();
    reader.join().unwrap();
    // Acknowledgements still in the pipe were written before the kill.
    seen.extend(acks.try_iter());
    let acked = seen.last().map_or(0, |&(n, _)| n);

    let (session, opened) = Session::open(&dir, REL).unwrap();
    let got = recovered_chars(&opened.lecture.text)
        .unwrap_or_else(|| panic!("not a prefix of the typing: {:?}", opened.lecture.text));
    session.close().unwrap();
    let lost_window =
        seen.iter().find(|&&(n, _)| n > got).map_or(Duration::ZERO, |&(_, at)| killed_at.saturating_duration_since(at));
    (acked, got, lost_window)
}

#[test]
fn sigkill_during_typing_loses_at_most_250_ms() {
    // Deep into the first burst (before any save), the second (after one save) and the third.
    // Each is over 300 ms of typing into its burst, so a journal that kept nothing would fail.
    for kill_after in [100, BURST + 90, 2 * BURST + 80] {
        let (acked, got, lost_window) = crash_once(kill_after);
        let lost = acked.saturating_sub(got);
        println!(
            "crash_loss: killed after {acked} acknowledged keystrokes; recovered {got}; lost {lost}; oldest lost keystroke {} ms before the kill (budget {} ms)",
            lost_window.as_millis(),
            LOSS_BUDGET.as_millis()
        );
        assert!(lost_window <= LOSS_BUDGET, "lost typing from {lost_window:?} before the kill");
    }
}
