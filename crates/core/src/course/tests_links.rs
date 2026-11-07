//! F-047: links in `slides/` that leave the course are listed (D-167), linked folders by the files
//! directly in them; hidden files and `.lecter/` internals are never slides or sources, even when a
//! link points at one (02-course-folder.md#trust, SEC-35).

#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::path::Path;

use super::tests::{env, file, link, mkdir, open_err, open_ok, touch};
use super::*;

/// Criterion 1: a file and a folder linked from slides/ to outside the course are listed, and the
/// open neither fails nor skips them. Files a linked folder holds that lead out of it, or are
/// hidden, are not.
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

    let listing = open_ok(&course);
    assert_eq!(
        listing.slides,
        vec![
            file("slides", "01-intro.pdf"),
            file("slides", "03-week3.pdf"),
            file("slides", "04-week4/a.pdf"),
            file("slides", "04-week4/b.pptx"),
        ]
    );
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

    let files = listing::files(&root, listing::Folder::Slides).unwrap_or_else(|e| panic!("{e:?}"));
    let reals: Vec<_> = files.iter().map(|(f, r)| (f.path.as_str(), r.clone())).collect();
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
    assert_eq!(open_ok(&course).slides, vec![file("slides", "week5/ok.pdf")]);
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

/// The entry limit counts a linked folder's entries too: exactly [`MAX_ENTRIES`] read lists, one
/// more is refused.
#[test]
fn a_linked_folders_entries_count_towards_the_limit() {
    let env = env();
    let folder = mkdir(env.home(), "big");
    for i in 0..MAX_ENTRIES - 2 {
        std::fs::write(folder.join(format!("{i}.pdf")), "").unwrap_or_else(|e| panic!("{e}"));
    }
    let course = mkdir(env.home(), "c");
    touch(&course, "slides/a.pdf");
    link(&folder, &course.join("slides/big"));
    assert_eq!(open_ok(&course).slides.len(), MAX_ENTRIES - 1);
    touch(&folder, "one-more.pdf");
    assert_eq!(open_err(&course), Error::TooManyEntries { folder: "slides", limit: MAX_ENTRIES });
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
