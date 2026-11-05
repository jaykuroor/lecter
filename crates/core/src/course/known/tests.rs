//! F-035: the rail's courses and their order in `<data>/state.db` (D-188), and stored course
//! roots checked as a dialog pick is (SEC-32, SEC-35).

#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::path::{Path, PathBuf};

use super::*;
use crate::ErrorCode;
use crate::testenv::TestEnv;

fn env() -> TestEnv {
    TestEnv::new().unwrap_or_else(|e| panic!("{e}"))
}

/// A course folder `name` in the test home, as `course_open` would store it.
fn folder(env: &TestEnv, name: &str) -> String {
    let p = env.home().join("courses").join(name);
    std::fs::create_dir_all(&p).unwrap_or_else(|e| panic!("{e}"));
    let canonical = std::fs::canonicalize(&p).unwrap_or_else(|e| panic!("{e}"));
    plain(canonical.to_str().unwrap_or_else(|| panic!("utf-8")))
}

fn ok<T>(r: Result<T>) -> T {
    r.unwrap_or_else(|e| panic!("{e:?}"))
}

/// The raw `courses` value in the state.db at `db`.
fn stored(db: &Path) -> Option<String> {
    let conn = rusqlite::Connection::open(db).unwrap_or_else(|e| panic!("{e}"));
    conn.query_row("SELECT value FROM meta WHERE key = 'courses'", [], |r| r.get(0)).ok()
}

/// Writes `value` as the raw `courses` value.
fn put(db: &Path, value: &str) {
    std::fs::create_dir_all(db.parent().unwrap_or(db)).unwrap_or_else(|e| panic!("{e}"));
    let conn = rusqlite::Connection::open(db).unwrap_or_else(|e| panic!("{e}"));
    conn.execute_batch("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
        .unwrap_or_else(|e| panic!("{e}"));
    conn.execute("INSERT OR REPLACE INTO meta VALUES ('courses', ?1)", [value]).unwrap_or_else(|e| panic!("{e}"));
}

fn db(env: &TestEnv) -> PathBuf {
    env.dirs().data().join("state.db")
}

#[test]
fn the_list_lives_under_courses_in_the_data_folders_state_db() {
    let env = env();
    let known = KnownCourses::new(&env.dirs());
    assert_eq!(ok(known.paths()), Vec::<String>::new());
    let stat = folder(&env, "stat311");
    let (paths, added) = ok(known.add(&stat));
    assert_eq!((paths, added), (vec![stat.clone()], true));
    assert_eq!(COURSES_KEY, "courses");
    assert_eq!(stored(&db(&env)), Some(serde_json::to_string(&[&stat]).unwrap_or_default()));
    // WAL, like every state.db (18-contracts.md#statedb-schema).
    let conn = rusqlite::Connection::open(db(&env)).unwrap_or_else(|e| panic!("{e}"));
    let mode: String = conn.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap_or_default();
    assert_eq!(mode, "wal");
}

#[test]
fn courses_join_at_the_end_once_each() {
    let env = env();
    let known = KnownCourses::new(&env.dirs());
    let (a, b) = (folder(&env, "a"), folder(&env, "b"));
    assert!(ok(known.add(&a)).1);
    assert!(ok(known.add(&b)).1);
    let (paths, added) = ok(known.add(&a));
    assert_eq!((paths, added), (vec![a.clone(), b.clone()], false));
    // A second handle on the same file sees the same list.
    assert_eq!(ok(KnownCourses::new(&env.dirs()).paths()), vec![a.clone(), b]);
    assert!(ok(known.contains(&a)));
    assert!(!ok(known.contains(&format!("{a}/"))));
}

/// An absolute path on this OS that needn't exist: `/c/<name>`, or `C:\c\<name>` on Windows.
fn abs(name: &str) -> String {
    if cfg!(windows) { format!(r"C:\c\{name}") } else { format!("/c/{name}") }
}

#[test]
fn a_path_that_cant_be_a_course_root_is_never_added() {
    let env = env();
    let known = KnownCourses::new(&env.dirs());
    let root = abs("");
    let long = format!("{root}{}", "x".repeat(MAX_PATH_BYTES + 1 - root.len()));
    let line_break = abs("line\nbreak");
    for bad in ["relative/course", "", line_break.as_str(), long.as_str()] {
        assert_eq!(ok(known.add(bad)), (vec![], false), "{bad:?}");
    }
    let edge = format!("{root}{}", "x".repeat(MAX_PATH_BYTES - root.len()));
    assert_eq!(edge.len(), MAX_PATH_BYTES);
    assert!(ok(known.add(&edge)).1);
}

/// Windows: canonicalisation gives `\\?\C:\…`; the rail keeps and answers the plain form, and
/// finds a course by either.
#[cfg(windows)]
#[test]
fn a_verbatim_windows_path_is_kept_in_its_plain_form() {
    let env = env();
    let known = KnownCourses::new(&env.dirs());
    let (paths, added) = ok(known.add(r"\\?\C:\Courses\stat"));
    assert_eq!((paths, added), (vec![r"C:\Courses\stat".to_owned()], true));
    assert!(!ok(known.add(r"C:\Courses\stat")).1, "the same course twice");
    assert!(ok(known.contains(r"\\?\C:\Courses\stat")));
    assert!(ok(known.contains(r"C:\Courses\stat")));
    ok(known.add(r"\\?\UNC\server\share\bio"));
    let order = vec![r"\\server\share\bio".to_owned(), r"\\?\C:\Courses\stat".to_owned()];
    assert_eq!(ok(known.reorder(&order)), vec![r"\\server\share\bio".to_owned(), r"C:\Courses\stat".to_owned()]);
    put(&db(&env), r#"["\\\\?\\C:\\Courses\\stat", "C:\\Courses\\stat"]"#);
    assert_eq!(ok(known.paths()), vec![r"C:\Courses\stat".to_owned()]);
}

/// The stored form leaves every path that isn't a Windows verbatim one as it is.
#[test]
fn stored_form_strips_only_the_windows_verbatim_prefix() {
    assert_eq!(stored_form(r"\\?\C:\Courses\stat"), r"C:\Courses\stat");
    assert_eq!(stored_form(r"\\?\UNC\server\share\bio"), r"\\server\share\bio");
    assert_eq!(stored_form("/c/stat"), "/c/stat");
    assert_eq!(stored_form(r"C:\Courses\stat"), r"C:\Courses\stat");
}

#[test]
fn reorder_takes_a_new_order_of_the_same_courses_only() {
    let env = env();
    let known = KnownCourses::new(&env.dirs());
    let (a, b, c) = (folder(&env, "a"), folder(&env, "b"), folder(&env, "c"));
    for p in [&a, &b, &c] {
        ok(known.add(p));
    }
    let order = vec![c.clone(), a.clone(), b.clone()];
    assert_eq!(ok(known.reorder(&order)), order);
    assert_eq!(ok(known.paths()), order);
    // The same order again changes nothing.
    assert_eq!(ok(known.reorder(&order)), order);
    let wrong: [Vec<String>; 5] = [
        vec![c.clone(), a.clone()],
        vec![c.clone(), a.clone(), b.clone(), "/elsewhere".into()],
        vec![c.clone(), a.clone(), a.clone()],
        vec![c.clone(), a.clone(), "/elsewhere".into()],
        vec![],
    ];
    for bad in wrong {
        let e = known.reorder(&bad).err().unwrap_or_else(|| panic!("{bad:?} was accepted"));
        assert!(matches!(e, Error::BadCourseOrder), "{bad:?}: {e:?}");
        assert_eq!(e.code(), ErrorCode::InvalidArgument);
    }
    assert_eq!(ok(known.paths()), order, "a refused order changes nothing");
}

#[test]
fn a_hand_edited_value_reads_as_the_usable_entries() {
    let env = env();
    let known = KnownCourses::new(&env.dirs());
    let json = |v: serde_json::Value| v.to_string();
    let (a, b) = (abs("a"), abs("b"));
    put(&db(&env), &json(serde_json::json!([a, 7, "relative", b, a, null, abs("line\nbreak")])));
    assert_eq!(ok(known.paths()), vec![a.clone(), b]);
    for broken in ["{\"courses\": []}".to_owned(), "not json".to_owned(), json(serde_json::json!(a)), String::new()] {
        put(&db(&env), &broken);
        assert_eq!(ok(known.paths()), Vec::<String>::new(), "{broken:?}");
    }
    // Reading never rewrites what is there; the next change does.
    assert_eq!(stored(&db(&env)).as_deref(), Some(""));
    let z = abs("z");
    ok(known.add(&z));
    assert_eq!(stored(&db(&env)), Some(json(serde_json::json!([z]))));
}

#[test]
fn the_list_stops_at_the_contracts_list_limit() {
    let env = env();
    let many: Vec<String> = (0..=MAX_ENTRIES).map(|i| abs(&i.to_string())).collect();
    put(&db(&env), &serde_json::to_string(&many).unwrap_or_default());
    let known = KnownCourses::new(&env.dirs());
    let paths = ok(known.paths());
    assert_eq!(paths.len(), MAX_ENTRIES);
    assert_eq!(paths.last(), Some(&abs(&(MAX_ENTRIES - 1).to_string())));
    // A full rail takes no more.
    assert!(!ok(known.add(&abs("new"))).1);
}

#[test]
fn a_state_db_that_is_not_a_database_is_an_io_error() {
    let env = env();
    let db = db(&env);
    std::fs::create_dir_all(db.parent().unwrap_or(&db)).unwrap_or_else(|e| panic!("{e}"));
    std::fs::write(&db, "this is not sqlite, it is long enough to have a header page")
        .unwrap_or_else(|e| panic!("{e}"));
    let e = KnownCourses::at(db).paths().err().unwrap_or_else(|| panic!("read a broken state.db"));
    assert!(matches!(e, Error::CourseListFailed), "{e:?}");
    assert_eq!(e.code(), ErrorCode::Io);
}

#[test]
fn list_shows_each_course_with_its_face_and_marks_missing_ones() {
    let env = env();
    let known = KnownCourses::new(&env.dirs());
    let stat = folder(&env, "stat311");
    std::fs::create_dir_all(Path::new(&stat).join(".lecter")).unwrap_or_else(|e| panic!("{e}"));
    std::fs::write(
        Path::new(&stat).join(".lecter/course.jsonc"),
        r##"{"version": 1, "name": "Probability", "icon": "P", "color": "#26a269"}"##,
    )
    .unwrap_or_else(|e| panic!("{e}"));
    let gone = folder(&env, "biology");
    ok(known.add(&stat));
    ok(known.add(&gone));
    std::fs::remove_dir(&gone).unwrap_or_else(|e| panic!("{e}"));
    let list = ok(known.list());
    assert_eq!(
        list,
        vec![
            KnownCourse {
                path: stat,
                name: "Probability".into(),
                icon: "P".into(),
                color: "#26a269".into(),
                missing: false
            },
            KnownCourse {
                path: gone,
                name: "biology".into(),
                icon: "B".into(),
                color: "#3584e4".into(),
                missing: true
            },
        ]
    );
}

#[cfg(unix)]
#[test]
fn a_course_whose_path_now_leads_elsewhere_is_missing_and_wont_open() {
    let env = env();
    let known = KnownCourses::new(&env.dirs());
    let course = folder(&env, "chem");
    ok(known.add(&course));
    // The folder moves away and a link to another folder takes its place.
    std::fs::rename(&course, env.home().join("moved")).unwrap_or_else(|e| panic!("{e}"));
    let other = folder(&env, "other");
    std::os::unix::fs::symlink(&other, &course).unwrap_or_else(|e| panic!("{e}"));
    assert!(ok(known.list())[0].missing);
    let e = stored_root(&known, &course).err().unwrap_or_else(|| panic!("opened through the link"));
    assert!(matches!(e, Error::CourseMoved), "{e:?}");
    assert_eq!(e.code(), ErrorCode::NotFound);
}

#[test]
fn stored_root_opens_only_a_course_on_the_rail_that_is_still_there() {
    let env = env();
    let known = KnownCourses::new(&env.dirs());
    let stat = folder(&env, "stat311");
    let other = folder(&env, "other");
    ok(known.add(&stat));
    assert_eq!(ok(stored_root(&known, &stat)), std::fs::canonicalize(&stat).unwrap_or_else(|e| panic!("{e}")));
    for (path, code) in [
        (other.as_str(), ErrorCode::InvalidArgument),
        (&format!("{stat}/."), ErrorCode::InvalidArgument),
        (&format!("{stat}/../stat311"), ErrorCode::InvalidArgument),
        ("relative", ErrorCode::InvalidArgument),
    ] {
        let e = stored_root(&known, path).err().unwrap_or_else(|| panic!("{path} opened"));
        assert!(matches!(e, Error::CourseNotKnown), "{path}: {e:?}");
        assert_eq!(e.code(), code);
    }
    std::fs::remove_dir(&stat).unwrap_or_else(|e| panic!("{e}"));
    let e = stored_root(&known, &stat).err().unwrap_or_else(|| panic!("a missing folder opened"));
    assert!(matches!(e, Error::CourseMoved), "{e:?}");
    // A file where the folder was is no course either.
    std::fs::write(&stat, "x").unwrap_or_else(|e| panic!("{e}"));
    assert!(matches!(stored_root(&known, &stat), Err(Error::CourseMoved)));
}
