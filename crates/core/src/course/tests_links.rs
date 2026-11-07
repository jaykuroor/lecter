//! F-047: links in `slides/` that leave the course are listed (D-167), linked folders by the files
//! directly in them once the course is trusted ([`LinkedFolders::Files`]), at most
//! [`LINKED_FOLDER_FILES`] each (D-277), and by name before; hidden files and `.lecter/` internals
//! are never slides or sources, even when a link points at one (02-course-folder.md#trust, SEC-35).

#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::path::Path;

use super::listing::LinkOut;
use super::tests::{env, file, link, mkdir, open_err, open_ok, touch};
use super::*;

/// The listing of a course trusted as it is now: linked folders outside it list their files.
fn open_files(course: &Path) -> CourseListing {
    open_with(course, LinkedFolders::Files).unwrap_or_else(|e| panic!("{e:?}"))
}

/// `n` empty files `00000.pdf`, `00001.pdf`, … in `dir/rel`.
fn files_of(dir: &Path, rel: &str, n: usize) {
    let dir = mkdir(dir, rel);
    for i in 0..n {
        std::fs::write(dir.join(format!("{i:05}.pdf")), "").unwrap_or_else(|e| panic!("{e}"));
    }
}

/// Criterion 1: a file and a folder linked from slides/ to outside the course are listed, and the
/// open neither fails nor skips them: a trusted course lists the folder's own visible files (not
/// those that lead out of it or are hidden); before trust the folder lists as itself (criterion 4).
#[test]
fn links_out_of_slides_are_listed_as_slides() {
    let env = env();
    let downloads = mkdir(env.home(), "Downloads");
    let pdf = touch(&downloads, "week3.pdf");
    let week4 = mkdir(&downloads, "week4");
    touch(&week4, "a.pdf");
    touch(&week4, "b.pptx");
    touch(&week4, ".hidden.pdf");
    touch(&week4, "deeper/c.pdf");
    let elsewhere = touch(env.home(), "elsewhere/x.pdf");
    link(&elsewhere, &week4.join("escape.pdf"));
    let course = mkdir(env.home(), "STAT311");
    touch(&course, "slides/01-intro.pdf");
    link(&pdf, &course.join("slides/03-week3.pdf"));
    link(&week4, &course.join("slides/04-week4"));

    let listing = open_files(&course);
    assert_eq!(
        listing.slides,
        vec![
            file("slides", "01-intro.pdf"),
            file("slides", "03-week3.pdf"),
            file("slides", "04-week4/a.pdf"),
            file("slides", "04-week4/b.pptx"),
        ]
    );
    assert_eq!(listing.capped, Vec::<String>::new());
    assert_eq!(
        open_ok(&course).slides,
        vec![file("slides", "01-intro.pdf"), file("slides", "03-week3.pdf"), file("slides", "04-week4")]
    );
}

/// Criterion 4: before trust (and read-only), course_open never reads a folder a slides/ link
/// leads to outside the course. That folder can't be read here at all, yet the course opens and
/// lists the link; only the trusted listing goes in, and fails on it.
#[cfg(unix)]
#[test]
fn an_untrusted_listing_never_reads_a_linked_folder() {
    use std::os::unix::fs::PermissionsExt;
    let env = env();
    // Empty, so a killed run still leaves the test home removable (crates/core/CLAUDE.md).
    let locked = mkdir(env.home(), "Downloads/locked");
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap_or_else(|e| panic!("{e}"));
    let course = mkdir(env.home(), "c");
    mkdir(&course, "slides");
    link(&locked, &course.join("slides/week4"));
    let names = open(&course);
    let files = open_with(&course, LinkedFolders::Files);
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(names.map(|l| l.slides), Ok(vec![file("slides", "week4")]));
    assert_eq!(files.err(), Some(Error::Io(std::io::ErrorKind::PermissionDenied)));
}

/// Each listed slide's real path is where its link leads; the links out are named with their
/// targets, the folders they lead to unread.
#[test]
fn links_out_are_named_with_their_targets() {
    let env = env();
    let pdf = touch(env.home(), "Downloads/week3.pdf");
    let folder = mkdir(env.home(), "Downloads/week4");
    touch(&folder, "a.pdf");
    let course = mkdir(env.home(), "c");
    touch(&course, "slides/in.pdf");
    link(&pdf, &course.join("slides/b.pdf"));
    link(&folder, &course.join("slides/a"));
    let root = std::fs::canonicalize(&course).unwrap_or_else(|e| panic!("{e}"));
    let real = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|e| panic!("{e}"));

    let files =
        listing::files(&root, listing::Folder::Slides, LinkedFolders::Files).unwrap_or_else(|e| panic!("{e:?}"));
    let reals: Vec<_> = files.files.iter().map(|(f, r)| (f.path.as_str(), r.clone())).collect();
    assert_eq!(
        reals,
        vec![
            ("slides/a/a.pdf", real(&folder.join("a.pdf"))),
            ("slides/b.pdf", real(&pdf)),
            ("slides/in.pdf", real(&course.join("slides/in.pdf"))),
        ]
    );
    let out = links_out(&root).unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(
        out,
        vec![
            LinkOut { path: "slides/a".into(), target: real(&folder), listed: true },
            LinkOut { path: "slides/b.pdf".into(), target: real(&pdf), listed: true },
        ]
    );
}

/// A real subfolder of slides/ stays unlisted (F-018); only a link brings a folder's files in.
#[test]
fn a_real_subfolder_of_slides_is_not_expanded() {
    let env = env();
    let course = mkdir(env.home(), "c");
    touch(&course, "slides/old/2025.pdf");
    touch(&course, "slides/now.pdf");
    assert_eq!(open_ok(&course).slides, vec![file("slides", "now.pdf")]);
}

/// Criterion 3: hidden files and `.lecter/` internals are never slides or sources, including when
/// a link points at one: into another course's `.lecter/` (a file and the folder), at a dotfile, at
/// a file in a hidden folder, and at this course's own internals.
#[test]
fn hidden_files_and_lecter_internals_are_never_slides_or_sources() {
    let env = env();
    let home = env.home();
    let other = mkdir(home, "Other Course");
    let state = touch(&other, ".lecter/state.db");
    let dotfile = touch(home, ".bashrc");
    let key = touch(home, ".ssh/id_ed25519");
    let course = mkdir(home, "c");
    let own = touch(&course, ".lecter/course.jsonc");
    let role = touch(&course, ".lecter/agents/tutor.md");
    touch(&course, "slides/real.pdf");
    touch(&course, "sources/book.pdf");
    mkdir(&course, "lectures");
    link(&state, &course.join("slides/state.pdf"));
    link(&other.join(".lecter"), &course.join("slides/internals"));
    link(&dotfile, &course.join("slides/rc.pdf"));
    link(&key, &course.join("slides/key.pdf"));
    link(&own, &course.join("slides/own.pdf"));
    link(&course.join(".lecter"), &course.join("slides/mine"));
    link(&own, &course.join("sources/settings.pdf"));
    link(&state, &course.join("sources/state.pdf"));
    link(&role, &course.join("lectures/tutor.md"));

    let listing = open_ok(&course);
    assert_eq!(listing.slides, vec![file("slides", "real.pdf")]);
    assert_eq!(listing.sources, vec![file("sources", "book.pdf")]);
    assert_eq!(listing.lectures, vec![]);

    // The links out are still named (for the trust screen), but none is listed.
    let root = std::fs::canonicalize(&course).unwrap_or_else(|e| panic!("{e}"));
    let out = links_out(&root).unwrap_or_else(|e| panic!("{e:?}"));
    let named: Vec<_> = out.iter().map(|l| (l.path.as_str(), l.listed)).collect();
    assert_eq!(
        named,
        vec![
            ("slides/internals", false),
            ("slides/key.pdf", false),
            ("slides/rc.pdf", false),
            ("slides/state.pdf", false)
        ]
    );
}

/// A linked folder that holds hidden folders or links into them brings none of their files.
#[test]
fn a_linked_folder_brings_no_hidden_files() {
    let env = env();
    let folder = mkdir(env.home(), "Downloads/week5");
    touch(&folder, "ok.pdf");
    let secret = touch(&folder, ".git/config");
    link(&secret, &folder.join("config.pdf"));
    let course = mkdir(env.home(), "c");
    mkdir(&course, "slides");
    link(&folder, &course.join("slides/week5"));
    assert_eq!(open_files(&course).slides, vec![file("slides", "week5/ok.pdf")]);
}

/// In a linked folder a dangling link is left out, but one that can't be resolved for any other
/// reason (a loop) is a file-system error, as it is directly in slides/.
#[cfg(unix)]
#[test]
fn a_linked_folders_dangling_link_is_left_out_and_a_loop_is_an_io_error() {
    let env = env();
    let folder = mkdir(env.home(), "Downloads/week6");
    touch(&folder, "ok.pdf");
    link(&env.home().join("gone.pdf"), &folder.join("gone.pdf"));
    let course = mkdir(env.home(), "c");
    mkdir(&course, "slides");
    link(&folder, &course.join("slides/week6"));
    assert_eq!(open_files(&course).slides, vec![file("slides", "week6/ok.pdf")]);
    link(&folder.join("loop.pdf"), &folder.join("loop.pdf"));
    let err = open_with(&course, LinkedFolders::Files).err().unwrap_or_else(|| panic!("opened"));
    assert!(matches!(err, Error::Io(_)), "{err:?}");
}

/// Lecture files are written by Lecter, so one linked out of the course still fails the open, and
/// so does a whole slides/ folder linked out: only links *in* slides/ belong (D-167).
#[test]
fn lectures_and_the_slides_folder_itself_still_refuse_links_out() {
    let env = env();
    let elsewhere = touch(env.home(), "other/l01.md");
    let course = mkdir(env.home(), "c");
    mkdir(&course, "lectures");
    link(&elsewhere, &course.join("lectures/l01.md"));
    assert_eq!(open_err(&course), Error::OutsideCourse("lectures/l01.md".into()));
    let d = mkdir(env.home(), "d");
    link(&env.home().join("other"), &d.join("slides"));
    assert_eq!(open_err(&d), Error::OutsideCourse("slides".into()));
}

/// D-277 (replaces F-047's first rule, which refused a course whose linked folder pushed slides/
/// past the entry limit): a linked folder lists at most [`LINKED_FOLDER_FILES`] files, the first by
/// name, and one cut short is named in `capped`; exactly that many is not cut. Even more entries
/// than a whole subfolder may hold never fail the open.
#[test]
fn a_linked_folder_is_capped_and_never_fails_the_open() {
    let env = env();
    let home = env.home();
    files_of(home, "exact", LINKED_FOLDER_FILES);
    files_of(home, "big", MAX_ENTRIES + 1);
    let course = mkdir(home, "c");
    touch(&course, "slides/a.pdf");
    link(&home.join("exact"), &course.join("slides/exact"));
    link(&home.join("big"), &course.join("slides/big"));

    let listing = open_files(&course);
    assert_eq!(listing.capped, vec!["slides/big".to_owned()]);
    let under = |dir: &str| listing.slides.iter().filter(|f| f.path.starts_with(&format!("slides/{dir}/"))).count();
    assert_eq!((under("exact"), under("big")), (LINKED_FOLDER_FILES, LINKED_FOLDER_FILES));
    let big: Vec<&str> =
        listing.slides.iter().filter(|f| f.name.starts_with("big/")).map(|f| f.name.as_str()).collect();
    assert_eq!((big[0], big[LINKED_FOLDER_FILES - 1]), ("big/00000.pdf", "big/00499.pdf"));
    assert_eq!(listing.slides.len(), 2 * LINKED_FOLDER_FILES + 1);
    let json = serde_json::to_value(&listing).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(json["capped"], serde_json::json!(["slides/big"]));
    // A listing with nothing cut short leaves the key out, as before D-277.
    assert!(serde_json::to_value(open_ok(&course)).unwrap_or_else(|e| panic!("{e}")).get("capped").is_none());
}

/// D-277: all linked folders together read a bounded number of entries; a folder reached past it
/// is listed in part and named in `capped`, the ones before it whole.
#[test]
fn linked_folders_share_one_bound_on_entries_read() {
    let env = env();
    let home = env.home();
    // 400 files and 7,600 hidden entries: two such folders read 16,000 entries in all.
    files_of(home, "Downloads/week", 400);
    let folder = home.join("Downloads/week");
    for i in 0..7_600 {
        std::fs::write(folder.join(format!(".h{i}")), "").unwrap_or_else(|e| panic!("{e}"));
    }
    let course = mkdir(home, "c");
    mkdir(&course, "slides");
    for name in ["a", "b", "c"] {
        link(&folder, &course.join("slides").join(name));
    }
    let listing = open_files(&course);
    assert_eq!(listing.capped, vec!["slides/c".to_owned()]);
    let under = |dir: &str| listing.slides.iter().filter(|f| f.path.starts_with(&format!("slides/{dir}/"))).count();
    assert_eq!((under("a"), under("b")), (400, 400));
    assert!(under("c") < 400, "{}", under("c"));
}

/// `hidden` looks only below the folder the two paths share: what a course sits under doesn't
/// count, a dot part anywhere after it does.
#[test]
fn hidden_judges_only_the_parts_below_the_shared_folder() {
    let root = Path::new("/home/u/.var/Courses/STAT311");
    for (target, want) in [
        ("/home/u/.var/Courses/STAT311/slides/a.pdf", false),
        ("/home/u/.var/Courses/Other/a.pdf", false),
        ("/home/u/Downloads/a.pdf", false),
        ("/home/u/.var/Courses/STAT311/.lecter/state.db", true),
        ("/home/u/.var/Courses/Other/.lecter/state.db", true),
        ("/home/u/.ssh/id", true),
        ("/home/u/Downloads/.a.pdf", true),
        ("/home/u", false),
        ("/etc/passwd", false),
        ("/.hidden/x", true),
    ] {
        assert_eq!(hidden(root, Path::new(target)), want, "{target}");
    }
}
