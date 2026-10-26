#![allow(clippy::disallowed_methods, reason = "tests build and read fixture files on plain test threads")]
#![allow(
    clippy::unwrap_used,
    reason = "this module is cfg(all(test, ..)), which clippy does not count as a test module"
)]

use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde_json::Value;

use super::*;
use crate::testenv::TestEnv;

const LECTURE: &str = "::: {.slide #s1 n=1}\n[Covariance measures how two variables move together.]{#s1b1}\n:::\n";
const REL: &str = "lectures/l07.md";

/// A course folder holding `lectures/l07.md` with `text`.
fn course(env: &TestEnv, text: &str) -> PathBuf {
    let dir = env.home().join("STAT311");
    std::fs::create_dir_all(dir.join("lectures")).unwrap();
    std::fs::write(dir.join(REL), text).unwrap();
    std::fs::canonicalize(dir).unwrap()
}

fn journal_lines(course: &Path) -> Vec<Value> {
    let log = course.join(".lecter/journal/l07.log");
    std::fs::read_to_string(log).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect()
}

fn on_disk(course: &Path) -> String {
    std::fs::read_to_string(course.join(REL)).unwrap()
}

fn edit(from: u32, to: u32, text: &str) -> Edit {
    Edit { from, to, text: text.into() }
}

/// Waits (up to 10 s) until `done` holds; returns when it first did.
fn wait_until(mut done: impl FnMut() -> bool) -> Instant {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !done() {
        assert!(Instant::now() < deadline, "timed out");
        #[allow(clippy::disallowed_methods, reason = "polls the file system with a deadline")]
        std::thread::sleep(Duration::from_millis(5));
    }
    Instant::now()
}

/// The UTF-16 position just after "Covariance" in LECTURE.
const AFTER_COVARIANCE: u32 = 32;

#[test]
fn opening_starts_the_journal_with_a_checkpoint_of_the_file() {
    let env = TestEnv::new().unwrap();
    let dir = course(&env, LECTURE);
    let (session, opened) = Session::open(&dir, REL).unwrap();
    assert_eq!(opened.lecture.text, LECTURE);
    assert_eq!((opened.recovered, opened.kept_aside), (false, None));
    let lines = journal_lines(&dir);
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0]["op"], "checkpoint");
    assert_eq!(lines[0]["base"], journal::blake3_hex(LECTURE.as_bytes()));
    assert_eq!(session.path(), REL);
    session.close().unwrap();
}

/// F-021.1: when `apply` returns, the edit is a contract record in the journal, with UTF-8 byte
/// offsets and the hash of the file on disk as its base.
#[test]
fn every_edit_is_in_the_journal_when_apply_returns() {
    let env = TestEnv::new().unwrap();
    let text = format!("é{LECTURE}");
    let dir = course(&env, &text);
    let (session, _) = Session::open(&dir, REL).unwrap();
    // After "é" (1 unit, 2 bytes) the slide line starts; insert inside "Covariance".
    session.apply(vec![edit(AFTER_COVARIANCE + 1, AFTER_COVARIANCE + 1, " (cov)")]).unwrap();
    session.apply(vec![edit(0, 1, "e")]).unwrap();
    let lines = journal_lines(&dir);
    assert_eq!(lines.len(), 3);
    let base = journal::blake3_hex(text.as_bytes());
    let fields = |r: &Value| {
        (r["v"].clone(), r["base"].clone(), r["op"].clone(), r["from"].clone(), r["to"].clone(), r["text"].clone())
    };
    assert_eq!(
        fields(&lines[1]),
        (1.into(), base.clone().into(), "replace".into(), 34.into(), 34.into(), " (cov)".into())
    );
    assert_eq!(fields(&lines[2]), (1.into(), base.into(), "replace".into(), 0.into(), 2.into(), "e".into()));
    let seqs: Vec<u64> = lines.iter().map(|r| r["seq"].as_u64().unwrap()).collect();
    assert_eq!(seqs, [1, 2, 3]);
    let now = journal::now_ms();
    let ts = lines[2]["ts"].as_u64().unwrap();
    assert!(ts <= now && now - ts < 60_000, "ts {ts} now {now}");
    session.close().unwrap();
}

/// F-021.2: the `.md` waits for 1 s without edits, then is replaced whole: no temp file stays,
/// and a checkpoint of the new file is in the journal.
#[test]
fn the_md_is_saved_atomically_1_s_after_the_last_edit() {
    let env = TestEnv::new().unwrap();
    let dir = course(&env, LECTURE);
    let (session, _) = Session::open(&dir, REL).unwrap();
    session.apply(vec![edit(AFTER_COVARIANCE, AFTER_COVARIANCE, ",")]).unwrap();
    session.apply(vec![edit(AFTER_COVARIANCE + 1, AFTER_COVARIANCE + 1, " roughly")]).unwrap();
    let last_edit = Instant::now();
    assert_eq!(on_disk(&dir), LECTURE, "saved before the debounce");
    let want = LECTURE.replace("Covariance", "Covariance, roughly");
    let saved = wait_until(|| on_disk(&dir) == want);
    let waited = saved - last_edit;
    assert!(waited >= Duration::from_millis(1000), "saved after {waited:?}");
    assert!(waited < Duration::from_secs(4), "saved after {waited:?}");
    assert!(!atomic::temp_path(&dir.join(REL)).exists());
    let lines = journal_lines(&dir);
    let last = lines.last().unwrap();
    assert_eq!(
        (last["op"].as_str(), last["base"].as_str()),
        (Some("checkpoint"), Some(journal::blake3_hex(want.as_bytes()).as_str()))
    );
    session.close().unwrap();
}

#[test]
fn close_saves_pending_edits_at_once() {
    let env = TestEnv::new().unwrap();
    let dir = course(&env, LECTURE);
    let (session, _) = Session::open(&dir, REL).unwrap();
    session.apply(vec![edit(0, 0, "% notes\n")]).unwrap();
    let lecture = session.lecture().unwrap();
    assert_eq!((lecture.path.as_str(), lecture.name.as_str()), (REL, "l07.md"));
    assert_eq!(lecture.text, format!("% notes\n{LECTURE}"));
    session.close().unwrap();
    assert_eq!(on_disk(&dir), format!("% notes\n{LECTURE}"));
    assert_eq!(session.apply(vec![edit(0, 0, "late")]).unwrap_err(), Error::LectureClosed(REL.into()));
}

#[test]
fn dropping_the_handle_saves_pending_edits() {
    let env = TestEnv::new().unwrap();
    let dir = course(&env, LECTURE);
    let (session, _) = Session::open(&dir, REL).unwrap();
    session.apply(vec![edit(0, 0, "x")]).unwrap();
    drop(session);
    wait_until(|| on_disk(&dir) == format!("x{LECTURE}"));
}

/// The crash case without a crash: the journal holds edits newer than the file (as a killed app
/// leaves it); opening replays them, then saves them to the `.md`.
#[test]
fn opening_replays_edits_the_file_does_not_have_yet() {
    let env = TestEnv::new().unwrap();
    let dir = course(&env, LECTURE);
    let base = journal::blake3_hex(LECTURE.as_bytes());
    let log = [
        journal::Record { v: 1, seq: 7, ts: 1, base: base.clone(), op: journal::Op::Checkpoint },
        journal::Record {
            v: 1,
            seq: 8,
            ts: 2,
            base,
            op: journal::Op::Replace { from: 0, to: 0, text: "% kept\n".into() },
        },
    ];
    std::fs::create_dir_all(dir.join(".lecter/journal")).unwrap();
    std::fs::write(dir.join(".lecter/journal/l07.log"), log.iter().map(journal::Record::line).collect::<String>())
        .unwrap();
    let (session, opened) = Session::open(&dir, REL).unwrap();
    let want = format!("% kept\n{LECTURE}");
    assert_eq!((opened.lecture.text.as_str(), opened.recovered), (want.as_str(), true));
    // The journal starts over from the file on disk, the replayed edit renumbered after the old ones.
    let lines = journal_lines(&dir);
    let summary: Vec<(u64, &str)> =
        lines.iter().map(|r| (r["seq"].as_u64().unwrap(), r["op"].as_str().unwrap())).collect();
    assert_eq!(summary, [(9, "checkpoint"), (10, "replace")]);
    wait_until(|| on_disk(&dir) == want);
    session.close().unwrap();
}

/// ROB-11: unsaved edits written against another version of the file aren't applied; the
/// journal is kept aside and the file opens as it is on disk.
#[test]
fn edits_against_another_version_are_kept_aside() {
    let env = TestEnv::new().unwrap();
    let dir = course(&env, LECTURE);
    let log = [
        journal::Record { v: 1, seq: 1, ts: 1, base: "f".repeat(64), op: journal::Op::Checkpoint },
        journal::Record {
            v: 1,
            seq: 2,
            ts: 2,
            base: "f".repeat(64),
            op: journal::Op::Replace { from: 0, to: 0, text: "x".into() },
        },
    ];
    let content: String = log.iter().map(journal::Record::line).collect();
    std::fs::create_dir_all(dir.join(".lecter/journal")).unwrap();
    std::fs::write(dir.join(".lecter/journal/l07.log"), &content).unwrap();
    let (session, opened) = Session::open(&dir, REL).unwrap();
    assert_eq!((opened.lecture.text.as_str(), opened.recovered), (LECTURE, false));
    let kept = opened.kept_aside.unwrap();
    assert_eq!(std::fs::read_to_string(kept).unwrap(), content);
    assert_eq!(journal_lines(&dir).len(), 1);
    session.close().unwrap();
    assert_eq!(on_disk(&dir), LECTURE);
}

/// 03-lecture-files.md: lectures are LF. A CRLF file opens with `\n` breaks, as CodeMirror shows
/// it, so buffer positions line up; it is rewritten only once edited.
#[test]
fn a_crlf_lecture_is_edited_with_lf_positions_and_saved_as_lf() {
    let env = TestEnv::new().unwrap();
    let crlf = LECTURE.replace('\n', "\r\n");
    let dir = course(&env, &crlf);
    let (session, opened) = Session::open(&dir, REL).unwrap();
    assert_eq!(opened.lecture.text, LECTURE);
    session.close().unwrap();
    assert_eq!(on_disk(&dir), crlf, "rewritten without an edit");
    let (session, _) = Session::open(&dir, REL).unwrap();
    session.apply(vec![edit(AFTER_COVARIANCE, AFTER_COVARIANCE, "!")]).unwrap();
    session.close().unwrap();
    assert_eq!(on_disk(&dir), LECTURE.replace("Covariance", "Covariance!"));
}

#[test]
fn a_misfit_or_oversized_edit_is_refused_with_its_code() {
    let env = TestEnv::new().unwrap();
    let dir = course(&env, LECTURE);
    let (session, _) = Session::open(&dir, REL).unwrap();
    let e = session.apply(vec![edit(10_000, 10_000, "x")]).unwrap_err();
    assert_eq!(
        (e.code(), e.to_string().as_str()),
        (crate::ErrorCode::InvalidArgument, "lectures/l07.md changed in a way Lecter could not follow; reopen it.")
    );
    let huge = "a".repeat(usize::try_from(crate::lecture::MAX_LECTURE_BYTES).unwrap());
    let e = session.apply(vec![edit(0, 0, &huge)]).unwrap_err();
    assert_eq!(e, Error::LectureTooLarge { path: REL.into(), limit: crate::lecture::MAX_LECTURE_BYTES });
    session.apply(vec![]).unwrap();
    assert_eq!(journal_lines(&dir).len(), 1, "a refused edit reached the journal");
    session.close().unwrap();
    assert_eq!(on_disk(&dir), LECTURE);
}

/// SEC-35: a `.lecter` link out of the course is refused before anything is written through it.
#[cfg(unix)]
#[test]
fn a_lecter_folder_linked_out_of_the_course_is_refused() {
    let env = TestEnv::new().unwrap();
    let dir = course(&env, LECTURE);
    let outside = env.home().join("outside");
    std::fs::create_dir_all(&outside).unwrap();
    std::os::unix::fs::symlink(&outside, dir.join(".lecter")).unwrap();
    let e = Session::open(&dir, REL).unwrap_err();
    assert_eq!(e, Error::OutsideCourse(".lecter/journal".into()));
    assert_eq!(std::fs::read_dir(&outside).unwrap().count(), 0, "wrote outside the course");
}

#[test]
fn the_lecture_path_is_checked_like_an_open() {
    let env = TestEnv::new().unwrap();
    let dir = course(&env, LECTURE);
    assert_eq!(Session::open(&dir, "slides/l07.md").unwrap_err(), Error::NotALecture("slides/l07.md".into()));
    assert_eq!(Session::open(&dir, "lectures/l08.md").unwrap_err(), Error::LectureNotFound("lectures/l08.md".into()));
}

#[test]
fn an_atomic_write_replaces_the_file_and_leaves_no_temp() {
    let env = TestEnv::new().unwrap();
    let target = env.home().join("a.md");
    std::fs::write(&target, "old").unwrap();
    std::fs::write(atomic::temp_path(&target), "left by a crash").unwrap();
    let mut seen = None;
    atomic::write(&target, b"new", || {
        // The temp file is complete before the checkpoint; the target is still the old file.
        seen = Some((std::fs::read_to_string(atomic::temp_path(&target))?, std::fs::read_to_string(&target)?));
        Ok(())
    })
    .unwrap();
    assert_eq!(seen, Some(("new".to_owned(), "old".to_owned())));
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "new");
    assert!(!atomic::temp_path(&target).exists());
    assert_eq!(atomic::temp_path(&target).file_name().unwrap(), ".a.md.tmp");
}

/// When the step before the rename fails (the journal checkpoint), the old file stays.
#[test]
fn a_failed_atomic_write_keeps_the_old_file() {
    let env = TestEnv::new().unwrap();
    let target = env.home().join("a.md");
    std::fs::write(&target, "old").unwrap();
    let e = atomic::write(&target, b"new", || Err(io::Error::other("journal full"))).unwrap_err();
    assert_eq!(e.to_string(), "journal full");
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "old");
    assert!(!atomic::temp_path(&target).exists());
}

/// A link planted at the temp path is replaced, never written through.
#[cfg(unix)]
#[test]
fn an_atomic_write_does_not_follow_a_link_at_the_temp_path() {
    let env = TestEnv::new().unwrap();
    let target = env.home().join("a.md");
    let victim = env.home().join("victim");
    std::fs::write(&victim, "untouched").unwrap();
    std::os::unix::fs::symlink(&victim, atomic::temp_path(&target)).unwrap();
    atomic::write(&target, b"new", || Ok(())).unwrap();
    assert_eq!(std::fs::read_to_string(&victim).unwrap(), "untouched");
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "new");
}
