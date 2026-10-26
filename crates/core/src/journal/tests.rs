#![allow(clippy::disallowed_methods, reason = "tests build fixture files on plain test threads")]
#![allow(
    clippy::unwrap_used,
    reason = "this module is cfg(all(test, ..)), which clippy does not count as a test module"
)]

use std::path::PathBuf;

use serde_json::{Value, json};

use super::*;

/// A fresh folder under a throwaway test home; removed when the returned env drops.
fn folder() -> (crate::testenv::TestEnv, PathBuf) {
    let env = crate::testenv::TestEnv::new().unwrap();
    let dir = env.home().join("journal");
    std::fs::create_dir_all(&dir).unwrap();
    (env, dir)
}

fn lines(path: &Path) -> Vec<Value> {
    std::fs::read_to_string(path).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect()
}

fn replace(seq: u64, base: &str, from: usize, to: usize, text: &str) -> Record {
    Record { v: 1, seq, ts: 1_761_200_000_123, base: base.into(), op: Op::Replace { from, to, text: text.into() } }
}

fn checkpoint(seq: u64, base: &str) -> Record {
    Record { v: 1, seq, ts: 1_761_200_000_123, base: base.into(), op: Op::Checkpoint }
}

fn log(records: &[Record]) -> Vec<u8> {
    records.iter().map(Record::line).collect::<String>().into_bytes()
}

/// 18-contracts.md#journal-records: the example record, field for field and in that order.
#[test]
fn a_replace_record_is_the_contract_line() {
    let r = replace(1042, "abc", 3810, 3815, "new words");
    assert_eq!(
        r.line(),
        "{\"v\":1,\"seq\":1042,\"ts\":1761200000123,\"base\":\"abc\",\"op\":\"replace\",\"from\":3810,\"to\":3815,\"text\":\"new words\"}\n"
    );
    assert_eq!(
        checkpoint(7, "h").line(),
        "{\"v\":1,\"seq\":7,\"ts\":1761200000123,\"base\":\"h\",\"op\":\"checkpoint\"}\n"
    );
}

#[test]
fn records_parse_back_and_other_versions_or_ops_do_not() {
    let r = replace(3, "h", 1, 2, "é\n\"q\"");
    assert_eq!(Record::parse(r.line().trim_end().as_bytes()), Some(r));
    assert_eq!(Record::parse(br#"{"v":2,"seq":1,"ts":1,"base":"h","op":"checkpoint"}"#), None);
    assert_eq!(Record::parse(br#"{"v":1,"seq":1,"ts":1,"base":"h","op":"rename"}"#), None);
    assert_eq!(Record::parse(br#"{"v":1,"seq":1,"ts":1,"base":"h","op":"replace","from":1}"#), None);
    assert_eq!(Record::parse(b"not json"), None);
}

#[test]
fn journal_file_is_named_after_the_lecture_stem() {
    assert_eq!(file_name("2026-10-23-l07-covariance.md"), "2026-10-23-l07-covariance.log");
    assert_eq!(file_name("l07.v2.md"), "l07.v2.log");
}

#[test]
fn replay_applies_every_edit_after_the_matching_checkpoint() {
    let records = [checkpoint(1, "H0"), replace(2, "H0", 5, 5, " big"), replace(3, "H0", 0, 1, "W")];
    let got = replay(&log(&records), "H0", "hello world");
    assert_eq!(got, Replay::Recovered { text: "Wello big world".into(), edits: records[1..].to_vec(), last_seq: 3 });
}

/// A checkpoint doesn't change the document: edits on both sides of a later, non-matching
/// checkpoint apply in order (the crash between writing a checkpoint and renaming the `.md`).
#[test]
fn replay_passes_over_a_later_checkpoint_the_disk_does_not_match() {
    let records = [checkpoint(1, "H0"), replace(2, "H0", 0, 0, "a"), checkpoint(3, "H1"), replace(4, "H1", 1, 1, "b")];
    match replay(&log(&records), "H0", "x") {
        Replay::Recovered { text, edits, last_seq } => {
            assert_eq!((text.as_str(), edits.len(), last_seq), ("abx", 2, 4));
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn replay_uses_the_last_checkpoint_that_matches() {
    let records = [checkpoint(1, "H0"), replace(2, "H0", 0, 0, "a"), checkpoint(3, "H1"), replace(4, "H1", 2, 2, "!")];
    // The `.md` was saved at H1 ("ax"): only the edit after that checkpoint applies.
    match replay(&log(&records), "H1", "ax") {
        Replay::Recovered { text, .. } => assert_eq!(text, "ax!"),
        other => panic!("{other:?}"),
    }
}

#[test]
fn nothing_after_the_matching_checkpoint_is_clean() {
    let records = [checkpoint(1, "H0"), replace(2, "H0", 0, 0, "a"), checkpoint(3, "H1")];
    assert_eq!(replay(&log(&records), "H1", "a"), Replay::Clean { last_seq: 3 });
    assert_eq!(replay(b"", "H1", "a"), Replay::Clean { last_seq: 0 });
}

/// ROB-11: unsaved edits written against another version of the file are never applied to this one.
#[test]
fn unsaved_edits_against_another_file_are_a_mismatch() {
    let records = [checkpoint(1, "H0"), replace(2, "H0", 0, 0, "a")];
    assert_eq!(replay(&log(&records), "OTHER", "x"), Replay::Mismatch { last_seq: 2 });
    // No checkpoint at all, but edits: also unknown ground.
    assert_eq!(replay(&log(&records[1..]), "H0", "x"), Replay::Mismatch { last_seq: 2 });
}

/// The file changed outside Lecter after a clean save: nothing is lost, so nothing to keep aside.
#[test]
fn a_changed_file_with_no_unsaved_edits_is_clean() {
    let records = [checkpoint(1, "H0"), replace(2, "H0", 0, 0, "a"), checkpoint(3, "H1")];
    assert_eq!(replay(&log(&records), "OTHER", "x"), Replay::Clean { last_seq: 3 });
}

#[test]
fn a_truncated_last_line_is_ignored() {
    let mut bytes = log(&[checkpoint(1, "H0"), replace(2, "H0", 0, 0, "a")]);
    let cut = replace(3, "H0", 1, 1, "b").line();
    bytes.extend_from_slice(&cut.as_bytes()[..cut.len() / 2]);
    match replay(&bytes, "H0", "x") {
        Replay::Recovered { text, last_seq, .. } => assert_eq!((text.as_str(), last_seq), ("ax", 2)),
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_damaged_line_before_the_last_is_a_mismatch() {
    let mut bytes = log(&[checkpoint(1, "H0"), replace(2, "H0", 0, 0, "a")]);
    bytes.extend_from_slice(b"{garbage}\n");
    bytes.extend_from_slice(replace(3, "H0", 1, 1, "b").line().as_bytes());
    assert_eq!(replay(&bytes, "H0", "x"), Replay::Mismatch { last_seq: 2 });
}

#[test]
fn an_edit_that_does_not_fit_the_text_is_a_mismatch() {
    for (from, to) in [(0, 9), (2, 1), (1, 1)] {
        // "é" is two bytes: offset 1 is inside it.
        let records = [checkpoint(1, "H0"), replace(2, "H0", from, to, "z")];
        assert_eq!(replay(&log(&records), "H0", "éx"), Replay::Mismatch { last_seq: 2 }, "{from}..{to}");
    }
}

#[test]
fn start_writes_a_checkpoint_then_the_unsaved_edits_renumbered() {
    let (_env, dir) = folder();
    let path = dir.join("l07.log");
    std::fs::write(&path, "old journal\n").unwrap();
    let j = Journal::start(&path, "H0", &[replace(40, "OLD", 1, 2, "x")], 9).unwrap();
    let got = lines(&path);
    assert_eq!(got.len(), 2);
    assert_eq!(
        (&got[0]["v"], &got[0]["seq"], &got[0]["base"], &got[0]["op"]),
        (&json!(1), &json!(9), &json!("H0"), &json!("checkpoint"))
    );
    assert_eq!(
        (&got[1]["seq"], &got[1]["base"], &got[1]["op"], &got[1]["from"], &got[1]["to"], &got[1]["text"]),
        (&json!(10), &json!("H0"), &json!("replace"), &json!(1), &json!(2), &json!("x"))
    );
    assert_eq!(j.len(), std::fs::metadata(&path).unwrap().len());
    assert!(!atomic_temp(&path).exists(), "temp file left behind");
}

fn atomic_temp(path: &Path) -> PathBuf {
    crate::save::atomic::temp_path(path)
}

#[test]
fn appends_carry_the_disk_base_until_a_save_lands() {
    let (_env, dir) = folder();
    let path = dir.join("l07.log");
    let mut j = Journal::start(&path, "H0", &[], 1).unwrap();
    j.append_edits(&[(0, 0, "a".into()), (1, 1, "b".into())]).unwrap();
    j.append_checkpoint("H1").unwrap();
    j.append_edits(&[(2, 2, "c".into())]).unwrap();
    j.saved("H1");
    j.append_edits(&[(3, 3, "d".into())]).unwrap();
    let got = lines(&path);
    let summary: Vec<(u64, &str, &str)> = got
        .iter()
        .map(|r| (r["seq"].as_u64().unwrap(), r["base"].as_str().unwrap(), r["op"].as_str().unwrap()))
        .collect();
    assert_eq!(
        summary,
        [
            (1, "H0", "checkpoint"),
            (2, "H0", "replace"),
            (3, "H0", "replace"),
            (4, "H1", "checkpoint"),
            (5, "H0", "replace"),
            (6, "H1", "replace")
        ]
    );
    assert_eq!(j.len(), std::fs::metadata(&path).unwrap().len());
    assert!(!j.is_empty());
}

#[test]
fn compact_starts_over_from_the_saved_base() {
    let (_env, dir) = folder();
    let path = dir.join("l07.log");
    let mut j = Journal::start(&path, "H0", &[], 1).unwrap();
    j.append_edits(&[(0, 0, "a".into())]).unwrap();
    j.saved("H1");
    j.compact().unwrap();
    j.append_edits(&[(1, 1, "b".into())]).unwrap();
    let got = lines(&path);
    assert_eq!(got.len(), 2);
    assert_eq!((&got[0]["seq"], &got[0]["base"], &got[0]["op"]), (&json!(3), &json!("H1"), &json!("checkpoint")));
    assert_eq!((&got[1]["seq"], &got[1]["op"]), (&json!(4), &json!("replace")));
    assert_eq!(j.path(), path);
}

#[test]
fn read_tells_missing_from_bytes() {
    let (_env, dir) = folder();
    let path = dir.join("l07.log");
    assert_eq!(read(&path).unwrap(), Existing::Missing);
    std::fs::write(&path, "x\n").unwrap();
    assert_eq!(read(&path).unwrap(), Existing::Bytes(b"x\n".to_vec()));
    std::fs::remove_file(&path).unwrap();
    std::fs::create_dir(&path).unwrap();
    assert_eq!(read(&path).unwrap(), Existing::Unusable);
}

/// SEC-35: a journal that is a link (perhaps out of the course) is never read.
#[cfg(unix)]
#[test]
fn read_does_not_follow_a_link() {
    let (_env, dir) = folder();
    let outside = dir.join("outside.log");
    std::fs::write(&outside, checkpoint(1, "H").line()).unwrap();
    let path = dir.join("l07.log");
    std::os::unix::fs::symlink(&outside, &path).unwrap();
    assert_eq!(read(&path).unwrap(), Existing::Unusable);
}

#[test]
fn keep_aside_moves_the_journal_next_to_itself() {
    let (_env, dir) = folder();
    let path = dir.join("l07.log");
    std::fs::write(&path, "records\n").unwrap();
    let kept = keep_aside(&path).unwrap();
    assert!(!path.exists());
    assert_eq!(kept.parent(), Some(dir.as_path()));
    let name = kept.file_name().unwrap().to_str().unwrap().to_owned();
    assert!(name.starts_with("l07.log.kept-") && name["l07.log.kept-".len()..].parse::<u64>().is_ok(), "{name}");
    assert_eq!(std::fs::read_to_string(&kept).unwrap(), "records\n");
}

#[test]
fn now_is_in_unix_milliseconds() {
    let ms = now_ms();
    // 2025-01-01 to 2100-01-01: seconds or microseconds would fall outside.
    assert!((1_735_689_600_000..4_102_444_800_000).contains(&ms), "{ms}");
}
