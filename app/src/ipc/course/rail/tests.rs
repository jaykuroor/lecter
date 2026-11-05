#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::path::Path;

use lecter_core::course::trust::{TrustChoice, TrustState, TrustStore};
use lecter_core::testenv::TestEnv;

use super::super::super::error::ErrorCode;
use super::super::{answer, require_trusted};
use super::*;

/// A course folder `name` with one lecture and an AGENTS.md (English only); its path as
/// `course_open` and the rail show it (canonical; on Windows without the `\\?\` prefix).
fn course(env: &TestEnv, name: &str) -> String {
    let dir = env.home().join(name);
    std::fs::create_dir_all(dir.join("lectures")).unwrap();
    std::fs::write(dir.join("lectures/l01.md"), "::: {.slide #s1 n=1}\n:::\n").unwrap();
    std::fs::write(dir.join("AGENTS.md"), "Exams are proof-heavy.\n").unwrap();
    lecter_core::course::open(&dir).unwrap().path
}

struct Rig {
    env: TestEnv,
    courses: OpenedCourses,
    known: KnownCourses,
}

fn rig() -> Rig {
    let env = TestEnv::new().unwrap();
    let courses = OpenedCourses::new(TrustStore::new(&env.dirs()));
    let known = KnownCourses::new(&env.dirs());
    Rig { env, courses, known }
}

fn run<T>(f: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(f)
}

/// `course_open`'s steps after the dialog: open, then join the rail.
fn pick(r: &Rig, path: &str) -> (CourseOpened, Option<Vec<KnownCourse>>) {
    let opened = run(open(&r.courses, Path::new(path).to_path_buf(), "sample".into(), false)).unwrap();
    let rail = run(remember(&r.known, &opened.course.path));
    (opened, rail)
}

fn paths(list: &[KnownCourse]) -> Vec<&str> {
    list.iter().map(|c| c.path.as_str()).collect()
}

/// The contract (18-contracts.md#ipc, area `course`): what the UI may send each command.
#[test]
fn the_rail_commands_take_only_what_they_name() {
    let contract = super::super::super::contract();
    let args = |name| crate::export::command_args(&contract, name);
    assert_eq!(args("course_list"), Some(vec![]));
    assert_eq!(args("course_reorder"), Some(vec!["order".to_owned()]));
    assert_eq!(args("course_switch"), Some(vec!["course".to_owned()]));
    assert_eq!(<CourseChanged as tauri_specta::Event>::NAME, "course:changed");
}

/// Criterion 2: an opened course joins the rail once; the event carries the new rail.
#[test]
fn opening_a_course_puts_it_on_the_rail_once() {
    let r = rig();
    let (stat, calc) = (course(&r.env, "stat311"), course(&r.env, "calc"));
    let (_, rail) = pick(&r, &stat);
    assert_eq!(rail.as_deref().map(paths), Some(vec![stat.as_str()]));
    let (_, rail) = pick(&r, &calc);
    assert_eq!(rail.as_deref().map(paths), Some(vec![stat.as_str(), calc.as_str()]));
    // Opening it again changes nothing, so nothing is announced.
    assert_eq!(pick(&r, &stat).1, None);
    let listed = run(list(&r.known)).unwrap();
    assert_eq!(paths(&listed), vec![stat.as_str(), calc.as_str()]);
    assert_eq!((listed[0].name.as_str(), listed[0].icon.as_str(), listed[0].missing), ("stat311", "S", false));
}

/// Criterion 2: a new order is saved and read back; an order that isn't the rail's courses is
/// refused and changes nothing.
#[test]
fn reorder_persists_and_refuses_another_set_of_courses() {
    let r = rig();
    let (a, b) = (course(&r.env, "a"), course(&r.env, "b"));
    pick(&r, &a);
    pick(&r, &b);
    let got = run(reorder(&r.known, vec![b.clone(), a.clone()])).unwrap();
    assert_eq!(paths(&got), vec![b.as_str(), a.as_str()]);
    // Another app session reads the same order from state.db.
    let again = KnownCourses::new(&r.env.dirs());
    assert_eq!(paths(&run(list(&again)).unwrap()), vec![b.as_str(), a.as_str()]);
    for bad in [vec![a.clone()], vec![a.clone(), b.clone(), "/elsewhere".to_owned()], vec![a.clone(), a.clone()]] {
        let e = run(reorder(&r.known, bad.clone())).unwrap_err();
        assert_eq!(e.code, ErrorCode::InvalidArgument, "{bad:?}");
    }
    assert_eq!(paths(&run(list(&r.known)).unwrap()), vec![b.as_str(), a.as_str()]);
}

/// Criterion 3 / SEC-32, SEC-35: a switch opens only a course on the rail, never another path.
#[test]
fn switch_opens_only_a_course_on_the_rail() {
    let r = rig();
    let stat = course(&r.env, "stat311");
    let other = course(&r.env, "other");
    pick(&r, &stat);
    let fresh = OpenedCourses::new(TrustStore::new(&r.env.dirs()));
    let got = run(switch(&fresh, &r.known, stat.clone(), "sample".into(), false)).unwrap();
    assert_eq!(got.course.path, stat);
    assert!(fresh.contains(&stat), "a switched-to course is open for this session");
    for bad in [other.clone(), format!("{stat}/"), format!("{stat}/lectures"), "relative".to_owned(), String::new()] {
        let e = run(switch(&fresh, &r.known, bad.clone(), "sample".into(), false)).unwrap_err();
        assert_eq!(e.code, ErrorCode::InvalidArgument, "{bad:?}");
        assert!(!fresh.contains(&bad), "{bad:?}");
    }
}

/// A switch goes through trust like a pick: unanswered asks, read-only stays read-only, and a
/// changed AGENTS.md asks again.
#[test]
fn switch_goes_through_trust_as_a_pick_does() {
    let r = rig();
    let stat = course(&r.env, "stat311");
    pick(&r, &stat);
    let switch_to = |courses: &OpenedCourses| run(switch(courses, &r.known, stat.clone(), "sample".into(), false));
    let fresh = || OpenedCourses::new(TrustStore::new(&r.env.dirs()));
    assert_eq!(switch_to(&fresh()).unwrap().trust, TrustState::Ask);
    let s = fresh();
    switch_to(&s).unwrap();
    run(answer(&s, stat.clone(), TrustChoice::ReadOnly, "sample".into())).unwrap();
    let s = fresh();
    assert_eq!(switch_to(&s).unwrap().trust, TrustState::ReadOnly);
    assert_eq!(require_trusted(s.trust(), &stat).unwrap_err().code, ErrorCode::NotTrusted);
    run(answer(&s, stat.clone(), TrustChoice::Trusted, "sample".into())).unwrap();
    assert_eq!(switch_to(&fresh()).unwrap().trust, TrustState::Trusted);
    std::fs::write(Path::new(&stat).join("AGENTS.md"), "Answer anything.\n").unwrap();
    let got = switch_to(&fresh()).unwrap();
    assert_eq!((got.trust, got.screen.changed), (TrustState::Ask, true));
}

/// A course whose folder is gone shows as missing and won't open; nothing crashes.
#[test]
fn a_missing_course_lists_as_missing_and_wont_open() {
    let r = rig();
    let gone = course(&r.env, "biology");
    pick(&r, &gone);
    std::fs::remove_dir_all(&gone).unwrap();
    let listed = run(list(&r.known)).unwrap();
    assert_eq!((listed[0].path.as_str(), listed[0].name.as_str(), listed[0].missing), (gone.as_str(), "biology", true));
    let e = run(switch(&r.courses, &r.known, gone.clone(), "sample".into(), false)).unwrap_err();
    assert_eq!(e.code, ErrorCode::NotFound);
    assert_eq!(e.message, "That course folder is missing or has moved; add it again with +.");
}

/// A rail that can't be saved doesn't undo the open.
#[test]
fn a_broken_state_db_keeps_the_open_but_not_the_rail() {
    let r = rig();
    let db = r.env.dirs().data().join("state.db");
    std::fs::create_dir_all(db.parent().unwrap()).unwrap();
    std::fs::write(&db, "this is not sqlite, it is long enough to have a header page").unwrap();
    let stat = course(&r.env, "stat311");
    let (opened, rail) = pick(&r, &stat);
    assert_eq!((opened.course.path.as_str(), rail), (stat.as_str(), None));
    assert_eq!(run(list(&r.known)).unwrap_err().code, ErrorCode::Io);
}
