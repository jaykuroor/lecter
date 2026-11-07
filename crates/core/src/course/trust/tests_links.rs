//! F-047: links in `slides/` that leave the course (D-167). The trust screen lists each one with
//! where it leads; nothing it leads to is read before the course is trusted, nor in a read-only
//! course; adding or re-pointing one asks again; and the AI's file API reaches outside the course
//! only through a listed `slides/` link of a trusted course (SEC-35, property test).

#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::path::{Path, PathBuf};

use proptest::prelude::*;
use proptest::test_runner::{Config, TestCaseError, TestRunner};

use super::tests::{env, link, reviewed, state_of, store, trust, unlink, write};
use super::*;
use crate::ErrorCode;
use crate::course::{LINKED_FOLDER_FILES, plain, within};
use crate::testenv::TestEnv;

fn real(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
}

/// How the screen names a link to `target`.
fn named(link: &str, target: &Path) -> String {
    format!("{link} → {}", plain(real(target).to_str().unwrap_or_else(|| panic!("utf-8"))))
}

/// The fixture: `<home>/c` is the course; `<home>/Downloads` holds what its slides/ links reach.
///
/// ```text
/// Downloads/week3.pdf  Downloads/week4/{a.pdf, .h.pdf, deep/b.pdf, esc.pdf -> secret.txt}
/// Downloads/.ssh/id    secret.txt
/// c/slides/01.pdf      c/notes.md
/// c/slides/w3.pdf -> Downloads/week3.pdf     c/slides/w4 -> Downloads/week4
/// c/slides/key.pdf -> Downloads/.ssh/id      c/slides/in.pdf -> c/notes.md
/// c/out -> Downloads   (a link out that is not in slides/)
/// ```
struct Fixture {
    course: PathBuf,
    downloads: PathBuf,
    week3: PathBuf,
    week4: PathBuf,
    key: PathBuf,
    secret: PathBuf,
}

fn fixture(env: &TestEnv) -> Fixture {
    let home = env.home();
    let downloads = home.join("Downloads");
    let week3 = write(&downloads, "week3.pdf", "week 3");
    let week4 = downloads.join("week4");
    write(&week4, "a.pdf", "a");
    write(&week4, ".h.pdf", "hidden");
    write(&week4, "deep/b.pdf", "deeper");
    let key = write(&downloads, ".ssh/id", "private key");
    let secret = write(home, "secret.txt", "secret");
    link(&secret, &week4.join("esc.pdf"));
    let course = home.join("c");
    write(&course, "slides/01.pdf", "x");
    write(&course, "notes.md", "x");
    link(&week3, &course.join("slides/w3.pdf"));
    link(&week4, &course.join("slides/w4"));
    link(&key, &course.join("slides/key.pdf"));
    link(&course.join("notes.md"), &course.join("slides/in.pdf"));
    link(&downloads, &course.join("out"));
    Fixture { course: real(&course), downloads: real(&downloads), week3, week4, key, secret }
}

/// Criterion 2: the screen lists every slides/ link that leaves the course, with where it leads
/// (one to something hidden is marked as never read), and none that stays inside; the linked
/// slides count.
#[test]
fn the_trust_screen_lists_every_link_out_of_the_course() {
    let env = env();
    let f = fixture(&env);
    let r = reviewed(&store(&env), &f.course);
    assert_eq!(
        r.screen.links,
        vec![
            format!("{} (hidden, never read)", named("slides/key.pdf", &f.key)),
            named("slides/w3.pdf", &f.week3),
            named("slides/w4", &f.week4),
        ]
    );
    // 01.pdf, in.pdf, w3.pdf, w4/a.pdf.
    assert_eq!(r.screen.slides, 4);
}

/// A course without links out has no links on its screen.
#[test]
fn a_course_without_links_out_lists_none() {
    let env = env();
    let c = env.home().join("c");
    write(&c, "slides/01.pdf", "x");
    assert_eq!(reviewed(&store(&env), &c).screen.links, Vec::<String>::new());
}

/// Criterion 4: before the course is trusted nothing a link leads to is read. The linked file here
/// can't be read at all, yet the course opens, its screen names the link, and the AI's file API
/// refuses it.
#[cfg(unix)]
#[test]
fn an_untrusted_course_reads_no_linked_file() {
    use std::os::unix::fs::PermissionsExt;
    let env = env();
    let f = fixture(&env);
    std::fs::set_permissions(&f.week3, std::fs::Permissions::from_mode(0o000)).unwrap_or_else(|e| panic!("{e}"));
    let st = store(&env);
    let r = reviewed(&st, &f.course);
    assert_eq!(r.state, TrustState::Ask);
    assert!(r.screen.links.contains(&named("slides/w3.pdf", &f.week3)), "{:?}", r.screen.links);
    assert_eq!(r.screen.blocked, None);
    let e = course_file(&st, &f.course, "slides/w3.pdf").err().unwrap_or_else(|| panic!("accepted"));
    assert_eq!(e, Error::CourseNotTrusted);
    assert_eq!(e.code(), ErrorCode::NotTrusted);
    std::fs::set_permissions(&f.week3, std::fs::Permissions::from_mode(0o644)).unwrap_or_else(|e| panic!("{e}"));
}

/// The listing [`super::open`] gives, as paths.
fn listed(st: &TrustStore, course: &Path) -> Vec<String> {
    let listing = super::open(st, course).unwrap_or_else(|e| panic!("{e:?}"));
    listing.slides.into_iter().map(|s| s.path).collect()
}

/// Criteria 1 and 4: the course's listing follows its trust. Before an answer and read-only, a
/// linked folder outside lists as itself; trusted as it is now, it lists its files; and when the
/// AI files change after Trust, it lists as itself again until the next answer.
#[test]
fn the_listing_reads_a_linked_folder_only_once_trusted() {
    let env = env();
    let f = fixture(&env);
    let st = store(&env);
    let by_name = ["slides/01.pdf", "slides/in.pdf", "slides/w3.pdf", "slides/w4"];
    let by_file = ["slides/01.pdf", "slides/in.pdf", "slides/w3.pdf", "slides/w4/a.pdf"];
    assert_eq!(listed(&st, &f.course), by_name);
    trust(&st, &f.course, TrustChoice::Trusted);
    assert_eq!(listed(&st, &f.course), by_file);
    write(&f.course, "AGENTS.md", "Changed after the answer.\n");
    assert_eq!(listed(&st, &f.course), by_name);
    trust(&st, &f.course, TrustChoice::ReadOnly);
    assert_eq!(listed(&st, &f.course), by_name);
}

/// D-277: on the screen of a trusted course's listing, a link whose folder is listed only in part
/// says so; one listed whole doesn't.
#[test]
fn a_capped_linked_folder_says_so_on_the_screen() {
    let env = env();
    let f = fixture(&env);
    for i in 0..=LINKED_FOLDER_FILES {
        write(&f.week4, &format!("{i:04}.pdf"), "");
    }
    let st = store(&env);
    trust(&st, &f.course, TrustChoice::Trusted);
    let listing = super::open(&st, &f.course).unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(listing.capped, vec!["slides/w4".to_owned()]);
    let screen = review(&st, &listing, "sample").unwrap_or_else(|e| panic!("{e:?}")).screen;
    assert_eq!(
        screen.links,
        vec![
            format!("{} (hidden, never read)", named("slides/key.pdf", &f.key)),
            named("slides/w3.pdf", &f.week3),
            format!("{} (only the first 500 files listed)", named("slides/w4", &f.week4)),
        ]
    );
}

/// Criterion 2: Open read-only keeps the links listed (a linked folder by its name, unread), but
/// the AI's file API never reaches what they lead to; files in the course still resolve.
#[test]
fn read_only_keeps_links_listed_but_never_reads_them() {
    let env = env();
    let f = fixture(&env);
    let st = store(&env);
    trust(&st, &f.course, TrustChoice::ReadOnly);
    assert_eq!(listed(&st, &f.course), ["slides/01.pdf", "slides/in.pdf", "slides/w3.pdf", "slides/w4"]);
    assert_eq!(reviewed(&st, &f.course).screen.links.len(), 3);
    for requested in ["slides/w3.pdf", "slides/w4/a.pdf"] {
        let e = course_file(&st, &f.course, requested).err().unwrap_or_else(|| panic!("{requested} accepted"));
        assert_eq!(e, Error::CourseReadOnly, "{requested}");
    }
    assert_eq!(course_file(&st, &f.course, "slides/01.pdf"), Ok(real(&f.course.join("slides/01.pdf"))));
}

/// Criteria 1 and 5: in a trusted course the AI reaches a linked file and a file directly in a
/// linked folder, however the path is spelled, but nothing else outside: not a hidden target, a
/// deeper file, a file a linked folder links out of itself, nor a link out from outside slides/.
#[test]
fn a_trusted_course_reaches_its_listed_links_only() {
    let env = env();
    let f = fixture(&env);
    let st = store(&env);
    trust(&st, &f.course, TrustChoice::Trusted);
    for (requested, want) in [
        ("slides/w3.pdf", real(&f.week3)),
        ("slides\\w3.pdf", real(&f.week3)),
        ("./slides//w4/a.pdf", real(&f.week4.join("a.pdf"))),
        ("slides\\w4\\a.pdf", real(&f.week4.join("a.pdf"))),
    ] {
        assert_eq!(course_file(&st, &f.course, requested), Ok(want), "{requested}");
    }
    for requested in [
        "slides/key.pdf",
        "slides/w4/.h.pdf",
        "slides/w4/deep/b.pdf",
        "slides/w4/esc.pdf",
        "slides/w4/../week3.pdf",
        "out/week3.pdf",
        "out/week4/a.pdf",
    ] {
        let e = course_file(&st, &f.course, requested).err().unwrap_or_else(|| panic!("{requested} accepted"));
        assert_eq!(e.code(), ErrorCode::NotTrusted, "{requested}: {e:?}");
    }
}

/// SEC-25 for links: adding one after the answer, or re-pointing one, asks again, and until then
/// the AI can't reach it; removing the only link brings back the answer given without it.
#[test]
fn a_link_added_or_repointed_after_trust_asks_again() {
    let env = env();
    let c = env.home().join("c");
    write(&c, "slides/01.pdf", "x");
    let one = write(env.home(), "Downloads/one.pdf", "1");
    let two = write(env.home(), "Downloads/two.pdf", "2");
    let st = store(&env);
    trust(&st, &c, TrustChoice::Trusted);
    let at = c.join("slides/linked.pdf");

    link(&one, &at);
    assert_eq!(state_of(&st, &c), TrustState::Ask);
    assert!(reviewed(&st, &c).screen.changed);
    assert_eq!(course_file(&st, &c, "slides/linked.pdf"), Err(Error::CourseNotTrusted));
    trust(&st, &c, TrustChoice::Trusted);
    assert_eq!(course_file(&st, &c, "slides/linked.pdf"), Ok(real(&one)));

    unlink(&at);
    link(&two, &at);
    assert_eq!(state_of(&st, &c), TrustState::Ask);
    assert_eq!(course_file(&st, &c, "slides/linked.pdf"), Err(Error::CourseNotTrusted));

    // Editing what a link leads to is not a change the screen shows: it stays trusted.
    trust(&st, &c, TrustChoice::Trusted);
    std::fs::write(&two, "2, edited").unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(state_of(&st, &c), TrustState::Trusted);

    // Without links the fingerprint is the one a course without them always had.
    unlink(&at);
    let plain_course = env.home().join("d");
    write(&plain_course, "slides/01.pdf", "x");
    let without = reviewed(&st, &plain_course).fingerprint;
    assert_eq!(reviewed(&st, &c).fingerprint, without);
}

/// One part of a generated path: names in the fixture, `.`, `..`, empty parts, drive-like names,
/// and whole ways into the slides/ links, so that paths through them come up often.
fn part() -> impl Strategy<Value = &'static str> {
    prop::sample::select(vec![
        "slides/w3.pdf",
        "slides\\w4\\a.pdf",
        "slides/w4",
        "slides/key.pdf",
        "slides",
        "w3.pdf",
        "w4",
        "a.pdf",
        ".h.pdf",
        "deep",
        "b.pdf",
        "esc.pdf",
        "key.pdf",
        "in.pdf",
        "01.pdf",
        "out",
        "week3.pdf",
        "week4",
        "Downloads",
        ".ssh",
        "id",
        "secret.txt",
        "notes.md",
        "c",
        "..",
        ".",
        "",
        "C:",
    ])
}

/// What a generated path may start with: nothing, a root, a drive, a UNC or verbatim prefix.
fn prefix() -> impl Strategy<Value = &'static str> {
    prop::sample::select(vec![
        "",
        "",
        "",
        "",
        "/",
        "\\",
        "C:\\",
        "\\\\server\\share\\",
        "//server/share/",
        "\\\\?\\C:\\",
        "\\\\?\\UNC\\s\\x\\",
    ])
}

/// Criterion 5, the property: whatever the AI asks for, an accepted path is under the course root
/// or is exactly one of the two listed slides reached through a link (in a trusted course only);
/// never the hidden target, the secret a linked folder leads out to, or anything else outside.
/// Any path with a root, drive or UNC prefix, a `..` or a `:` is E_NOT_TRUSTED.
#[test]
fn no_generated_path_escapes_except_through_a_listed_slides_link() {
    let env = env();
    let f = fixture(&env);
    let st = store(&env);
    let listed = [real(&f.week3), real(&f.week4.join("a.pdf"))];
    for choice in [TrustChoice::Trusted, TrustChoice::ReadOnly] {
        trust(&st, &f.course, choice);
        let reached = std::cell::Cell::new(0_u32);
        let strategy = (prefix(), prop::collection::vec((part(), prop::bool::ANY), 1..6));
        let mut runner = TestRunner::new(Config { cases: 2048, failure_persistence: None, ..Config::default() });
        let result = runner.run(&strategy, |(prefix, parts)| {
            let mut requested = prefix.to_owned();
            for (i, (p, back)) in parts.iter().enumerate() {
                if i > 0 {
                    requested.push(if *back { '\\' } else { '/' });
                }
                requested.push_str(p);
            }
            let got = course_file(&st, &f.course, &requested);
            if got.as_ref().is_ok_and(|r| listed.contains(r)) {
                reached.set(reached.get() + 1);
            }
            if let Ok(r) = &got {
                let through_link = choice == TrustChoice::Trusted && listed.contains(r);
                prop_assert!(within(&f.course, r) || through_link, "{choice:?} {requested:?} → {}", r.display());
                prop_assert!(!r.starts_with(&f.downloads) || through_link, "{requested:?} → {}", r.display());
                prop_assert_ne!(r, &real(&f.secret));
                prop_assert_ne!(r, &real(&f.key));
                prop_assert_eq!(r, &std::fs::canonicalize(r).map_err(|e| TestCaseError::fail(e.to_string()))?);
            }
            let names: Vec<&str> = parts.iter().map(|(p, _)| *p).collect();
            if !prefix.is_empty() || names.iter().any(|n| *n == ".." || n.contains(':')) {
                prop_assert_eq!(
                    got.as_ref().map_err(Error::code).err(),
                    Some(ErrorCode::NotTrusted),
                    "{:?}",
                    requested
                );
            }
            Ok(())
        });
        if let Err(e) = result {
            panic!("{choice:?}: {e}");
        }
        // The generator does reach the listed links; only a trusted course lets them through.
        let reached = reached.get();
        assert_eq!(reached > 0, choice == TrustChoice::Trusted, "{choice:?}: {reached} paths reached a listed link");
    }
}
