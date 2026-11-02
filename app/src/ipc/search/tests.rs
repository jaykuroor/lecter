#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use lecter_core::save::{Edit, Session};
use lecter_core::testenv::TestEnv;

use super::*;

const L07: &str = "lectures/l07.md";
const L08: &str = "lectures/l08.md";

/// Synthetic lectures as Lecter writes them (03-lecture-files.md#body). English only.
const SEVEN: &str = "---\ntitle: Covariance\n---\n\n::: {.slide #s1 n=1 title=\"Definition\"}\n## Definition\n\n[Covariance measures how two variables move together.]{#s1b1}\n\n[It is zero for independent variables.]{#s1b2 .flag}\n:::\n";
const EIGHT: &str = "---\ntitle: Regression\n---\n\n::: {.slide #s2 n=2 title=\"Fit\"}\n## Fit\n\n[Residuals sum to zero.]{#s2b1}\n:::\n";

/// A course folder with two lectures, remembered as opened this session.
fn course(env: &TestEnv) -> (String, OpenedCourses) {
    let dir = env.home().join("STAT311");
    std::fs::create_dir_all(dir.join("lectures")).unwrap();
    std::fs::write(dir.join(L07), SEVEN).unwrap();
    std::fs::write(dir.join(L08), EIGHT).unwrap();
    let listing = lecter_core::course::open(&std::fs::canonicalize(&dir).unwrap()).unwrap();
    let courses = OpenedCourses::default();
    courses.remember(&listing.path);
    (listing.path, courses)
}

/// Opens `path`'s save session, as `lecture_open` does.
fn open(lectures: &OpenLectures, course: &str, path: &str) -> Arc<Session> {
    let (session, _) = lectures
        .get_or_open(course, path, || Session::open(Path::new(course), path).map(|(s, _)| s))
        .unwrap_or_else(|e| panic!("{e:?}"));
    session
}

fn call(
    courses: &OpenedCourses,
    lectures: &OpenLectures,
    indexes: &SearchIndexes,
    course: &str,
    query: &str,
) -> Result<Vec<FindHit>, IpcError> {
    tauri::async_runtime::block_on(find(courses, lectures, indexes, course.to_owned(), query.to_owned()))
}

fn ids(hits: &[FindHit]) -> Vec<(&str, &str)> {
    hits.iter().map(|h| (h.lecture.as_str(), h.block.as_str())).collect()
}

/// F-022 criterion 2: search_find returns ranked hits with their block ids.
#[test]
fn find_returns_the_open_lectures_blocks_ranked_with_their_ids() {
    let env = TestEnv::new().unwrap();
    let (path, courses) = course(&env);
    let (lectures, indexes) = (OpenLectures::default(), SearchIndexes::default());
    open(&lectures, &path, L07);
    let hits = call(&courses, &lectures, &indexes, &path, "variables").unwrap();
    // Both blocks say "variables" once; the shorter one ranks first.
    assert_eq!(ids(&hits), [(L07, "s1b2"), (L07, "s1b1")]);
    assert_eq!(
        hits[0],
        FindHit {
            lecture: L07.into(),
            slide: "s1".into(),
            block: "s1b2".into(),
            text: "It is zero for independent variables.".into(),
            breadcrumb: "Covariance › Definition".into(),
        }
    );
    // A lecture never opened isn't indexed: "residuals" is only in l08.
    assert!(call(&courses, &lectures, &indexes, &path, "residuals").unwrap().is_empty());
}

/// Edits since the lecture was opened are searchable: the open lecture is re-indexed first.
#[test]
fn find_sees_the_open_lectures_unsaved_edits() {
    let env = TestEnv::new().unwrap();
    let (path, courses) = course(&env);
    let (lectures, indexes) = (OpenLectures::default(), SearchIndexes::default());
    let session = open(&lectures, &path, L07);
    assert_eq!(call(&courses, &lectures, &indexes, &path, "together").unwrap().len(), 1);
    // "together" → "jointly" in s1b1 (UTF-16 positions = byte positions here: ASCII only).
    let at = u32::try_from(SEVEN.find("together").unwrap()).unwrap();
    session.apply(vec![Edit { from: at, to: at + 8, text: "jointly".into() }]).unwrap();
    assert!(call(&courses, &lectures, &indexes, &path, "together").unwrap().is_empty());
    assert_eq!(ids(&call(&courses, &lectures, &indexes, &path, "jointly").unwrap()), [(L07, "s1b1")]);
}

/// Opening a lecture indexes it in the background; it stays searchable after another lecture
/// replaces it in the buffer.
#[test]
fn an_opened_lecture_stays_searchable_after_it_is_closed() {
    let env = TestEnv::new().unwrap();
    let (path, courses) = course(&env);
    let (lectures, indexes) = (OpenLectures::default(), SearchIndexes::default());
    tauri::async_runtime::block_on(index_in_background(&indexes, path.clone(), L08.into(), EIGHT.into())).unwrap();
    open(&lectures, &path, L07);
    assert_eq!(ids(&call(&courses, &lectures, &indexes, &path, "residuals").unwrap()), [(L08, "s2b1")]);
    // "zero" is in both lectures now.
    assert_eq!(call(&courses, &lectures, &indexes, &path, "zero").unwrap().len(), 2);
}

/// SEC-32: the query is at most 1 KB (`limits.ipc.query`); the course must be one picked this
/// session, and a refused call writes nothing.
#[test]
fn queries_over_1_kb_and_courses_not_opened_are_refused() {
    let env = TestEnv::new().unwrap();
    let (path, courses) = course(&env);
    let (lectures, indexes) = (OpenLectures::default(), SearchIndexes::default());
    let e = call(&courses, &lectures, &indexes, &path, &"a".repeat(1025)).unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidArgument);
    assert!(!Path::new(&path).join(".lecter").exists(), "a refused call touched the course");
    assert!(call(&courses, &lectures, &indexes, &path, &"a".repeat(1024)).unwrap().is_empty());
    let other = OpenedCourses::default();
    let e = call(&other, &lectures, &indexes, &path, "zero").unwrap_err();
    assert_eq!((e.code, e.message.as_str()), (ErrorCode::InvalidArgument, "Open the course before its lectures."));
}

#[test]
fn a_query_without_words_finds_nothing() {
    let env = TestEnv::new().unwrap();
    let (path, courses) = course(&env);
    let (lectures, indexes) = (OpenLectures::default(), SearchIndexes::default());
    open(&lectures, &path, L07);
    for q in ["", "  ", "?!"] {
        assert!(call(&courses, &lectures, &indexes, &path, q).unwrap().is_empty(), "{q:?}");
    }
}

/// The contract: `search_find(course, query)` (18-contracts.md#ipc, area `search`).
#[test]
fn search_find_takes_the_course_and_the_query() {
    let contract = super::super::contract();
    let args = crate::export::command_args(&contract, "search_find");
    assert_eq!(args, Some(vec!["course".to_owned(), "query".to_owned()]));
}

/// A lecture deleted since it was indexed: its hits are dropped and its entries forgotten.
#[test]
fn hits_of_a_deleted_lecture_are_dropped() {
    let env = TestEnv::new().unwrap();
    let (path, courses) = course(&env);
    let (lectures, indexes) = (OpenLectures::default(), SearchIndexes::default());
    tauri::async_runtime::block_on(index_in_background(&indexes, path.clone(), L08.into(), EIGHT.into())).unwrap();
    open(&lectures, &path, L07);
    assert_eq!(call(&courses, &lectures, &indexes, &path, "zero").unwrap().len(), 2);
    std::fs::remove_file(Path::new(&path).join(L08)).unwrap();
    assert_eq!(ids(&call(&courses, &lectures, &indexes, &path, "zero").unwrap()), [(L07, "s1b2")]);
    // Forgotten, not just hidden: the file coming back doesn't bring the old entries back.
    std::fs::write(Path::new(&path).join(L08), EIGHT).unwrap();
    assert_eq!(ids(&call(&courses, &lectures, &indexes, &path, "zero").unwrap()), [(L07, "s1b2")]);
}

/// 02-course-folder.md: `.lecter/cache` is a cache that can be deleted. An index folder deleted
/// while the app runs is rebuilt on the next `search_find`, with the open lectures in it again.
#[test]
fn find_rebuilds_an_index_folder_deleted_while_the_app_runs() {
    let env = TestEnv::new().unwrap();
    let (path, courses) = course(&env);
    let (lectures, indexes) = (OpenLectures::default(), SearchIndexes::default());
    open(&lectures, &path, L07);
    assert_eq!(call(&courses, &lectures, &indexes, &path, "variables").unwrap().len(), 2);
    let dir = Path::new(&path).join(lecter_index::INDEX_DIR);
    std::fs::remove_dir_all(&dir).unwrap();
    let hits = call(&courses, &lectures, &indexes, &path, "variables").unwrap();
    assert_eq!(ids(&hits), [(L07, "s1b2"), (L07, "s1b1")]);
    assert!(dir.join("meta.json").is_file(), "the index was not written again on disk");
}

/// The same for the background index `lecture_open` starts: a lecture opened after the index
/// folder was deleted is indexed into a new one, and stays searchable once closed.
#[test]
fn a_lecture_opened_after_the_index_folder_was_deleted_is_searchable() {
    let env = TestEnv::new().unwrap();
    let (path, courses) = course(&env);
    let (lectures, indexes) = (OpenLectures::default(), SearchIndexes::default());
    open(&lectures, &path, L07);
    assert_eq!(call(&courses, &lectures, &indexes, &path, "zero").unwrap().len(), 1);
    let dir = Path::new(&path).join(lecter_index::INDEX_DIR);
    std::fs::remove_dir_all(&dir).unwrap();
    tauri::async_runtime::block_on(index_in_background(&indexes, path.clone(), L08.into(), EIGHT.into())).unwrap();
    assert!(dir.join("meta.json").is_file(), "the background index did not write a new index");
    // l08 is not open: only the background index put it there. l07 is open and comes back too.
    assert_eq!(ids(&call(&courses, &lectures, &indexes, &path, "residuals").unwrap()), [(L08, "s2b1")]);
    assert_eq!(call(&courses, &lectures, &indexes, &path, "zero").unwrap().len(), 2);
}
