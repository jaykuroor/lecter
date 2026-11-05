//! F-033 criteria 3 and 5: the stored answer stays in force while the course's AI files are as the
//! user saw them, and every change to them asks again (SEC-25), up to the edges of the survey:
//! the list cap, hidden files, depth, and links inside the course (tests_blocked.rs has the
//! surveys that can't finish).

#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::path::Path;

use super::tests::{course, env, link, reviewed, state_of, store, trust, write};
use super::*;
use crate::course::MAX_ENTRIES;

/// Criterion 3: an answer is in force on the next open while nothing changed: the screen isn't
/// shown again and doesn't say "changed".
#[test]
fn a_stored_answer_is_in_force_on_the_next_review() {
    for (choice, want) in [(TrustChoice::Trusted, TrustState::Trusted), (TrustChoice::ReadOnly, TrustState::ReadOnly)] {
        let env = env();
        let c = course(&env, "STAT311");
        let st = store(&env);
        trust(&st, &c, choice);
        let r = reviewed(&st, &c);
        assert_eq!((r.state, r.screen.changed), (want, false), "{choice:?}");
    }
}

/// A list of exactly MAX_LISTED names is shown whole, with no "… and N more" line.
#[test]
fn a_list_of_exactly_the_cap_is_shown_whole() {
    let env = env();
    let c = course(&env, "STAT311");
    std::fs::remove_file(c.join(".lecter/agents/tutor.md")).unwrap_or_else(|e| panic!("{e}"));
    for i in 0..survey::MAX_LISTED {
        write(&c, &format!(".lecter/agents/r{i:03}.md"), "x");
    }
    let roles = reviewed(&store(&env), &c).screen.roles;
    assert_eq!(roles.len(), survey::MAX_LISTED);
    assert_eq!(roles.last().map(String::as_str), Some(".lecter/agents/r199.md"));
}

/// Hidden role files aren't roles and aren't listed; a hidden file a skill carries (a script) is
/// part of the skill, so adding one asks again.
#[test]
fn hidden_roles_are_not_listed_but_hidden_skill_files_count() {
    let env = env();
    let c = course(&env, "STAT311");
    write(&c, ".lecter/agents/.draft.md", "Not a role yet.\n");
    let st = store(&env);
    assert_eq!(reviewed(&st, &c).screen.roles, vec![".lecter/agents/tutor.md".to_owned()]);
    trust(&st, &c, TrustChoice::Trusted);
    write(&c, ".lecter/skills/flashcards/.hook.sh", "echo hi\n");
    assert_eq!(state_of(&st, &c), TrustState::Ask);
}

/// Criterion 5 at any depth: a file deep inside a skill is covered like any other.
#[test]
fn a_file_deep_inside_a_skill_still_asks_again() {
    let env = env();
    let c = course(&env, "STAT311");
    let deep = format!(".lecter/skills/flashcards/{}run.sh", "d/".repeat(40));
    write(&c, &deep, "echo one\n");
    let st = store(&env);
    trust(&st, &c, TrustChoice::Trusted);
    write(&c, &deep, "echo two\n");
    assert_eq!(state_of(&st, &c), TrustState::Ask);
}

/// Criterion 1: the sources count stops at MAX_ENTRIES entries looked at; a `sources` that is a
/// file holds none.
#[test]
fn the_sources_count_stops_at_max_entries() {
    let env = env();
    let c = env.home().join("Big");
    for i in 0..MAX_ENTRIES + 5 {
        write(&c, &format!("sources/b{i:05}.pdf"), "");
    }
    assert_eq!(reviewed(&store(&env), &c).screen.sources, u32::try_from(MAX_ENTRIES).unwrap_or(u32::MAX));
    let f = env.home().join("Flat");
    write(&f, "sources", "not a folder");
    assert_eq!(reviewed(&store(&env), &f).screen.sources, 0);
}

/// Criterion 1: a link in `sources/` counts only when it leads to a file inside the course; a link
/// out, or to a folder, doesn't (and the folder isn't walked).
#[test]
fn only_links_to_files_inside_count_as_sources() {
    let env = env();
    let c = course(&env, "STAT311");
    let outside = write(env.home(), "elsewhere/book.pdf", "x");
    link(&c.join("slides/01.pdf"), &c.join("sources/linked.pdf"));
    link(&outside, &c.join("sources/out.pdf"));
    link(&c.join("slides"), &c.join("sources/slides"));
    assert_eq!(reviewed(&store(&env), &c).screen.sources, 4);
}

/// Criterion 5 through links inside the course: editing the file a skill links to asks again, and
/// so does pointing a skill's folder link at another folder.
#[test]
fn what_a_skill_links_to_inside_the_course_counts() {
    let env = env();
    let c = course(&env, "STAT311");
    write(&c, "notes/rubric.md", "Grade fairly.\n");
    write(&c, "data/a/x.csv", "1\n");
    write(&c, "data/b/x.csv", "1\n");
    link(&c.join("notes/rubric.md"), &c.join(".lecter/skills/flashcards/rubric.md"));
    link(&c.join("data/a"), &c.join(".lecter/skills/flashcards/data"));
    let st = store(&env);
    trust(&st, &c, TrustChoice::Trusted);
    write(&c, "notes/rubric.md", "Grade harshly.\n");
    assert_eq!(state_of(&st, &c), TrustState::Ask, "linked file edited");
    trust(&st, &c, TrustChoice::Trusted);
    std::fs::remove_file(c.join(".lecter/skills/flashcards/data")).unwrap_or_else(|e| panic!("{e}"));
    link(&c.join("data/b"), &c.join(".lecter/skills/flashcards/data"));
    assert_eq!(state_of(&st, &c), TrustState::Ask, "folder link re-pointed");
}

/// Criterion 5 inside a linked folder: a skill that is a link to a folder elsewhere in the course
/// is that folder's files, so editing, adding or removing one asks again.
#[test]
fn a_change_inside_a_folder_a_skill_links_to_asks_again() {
    type Change = fn(&Path);
    let changes: [(&str, Change); 4] = [
        ("file edited", |c| drop(write(c, "notes/pack/SKILL.md", "Make many cards.\n"))),
        ("file added", |c| drop(write(c, "notes/pack/scripts/run.sh", "echo hi\n"))),
        ("file removed", |c| std::fs::remove_file(c.join("notes/pack/SKILL.md")).unwrap_or_else(|e| panic!("{e}"))),
        ("nested file edited", |c| drop(write(c, "notes/pack/deck/cards.md", "Q2\n"))),
    ];
    for (what, change) in changes {
        let env = env();
        let c = course(&env, "STAT311");
        write(&c, "notes/pack/SKILL.md", "Make cards.\n");
        write(&c, "notes/pack/deck/cards.md", "Q1\n");
        link(&c.join("notes/pack"), &c.join(".lecter/skills/pack"));
        let st = store(&env);
        assert_eq!(reviewed(&st, &c).screen.skills, vec![".lecter/skills/flashcards", ".lecter/skills/pack"]);
        trust(&st, &c, TrustChoice::Trusted);
        assert_eq!(state_of(&st, &c), TrustState::Trusted, "{what}: before");
        change(&c);
        assert_eq!(state_of(&st, &c), TrustState::Ask, "{what}");
    }
}

/// Links that lead back to a folder the walk already covers (the skills folder, a skill, each
/// other) are covered once and don't loop.
#[test]
fn links_back_into_the_skills_are_walked_once() {
    let env = env();
    let c = course(&env, "STAT311");
    link(&c.join(".lecter/skills"), &c.join(".lecter/skills/flashcards/all"));
    write(&c, "notes/a/x.md", "x\n");
    link(&c.join("notes"), &c.join("notes/a/up"));
    link(&c.join("notes/a"), &c.join(".lecter/skills/a"));
    let st = store(&env);
    trust(&st, &c, TrustChoice::Trusted);
    assert_eq!(state_of(&st, &c), TrustState::Trusted);
    write(&c, "notes/a/x.md", "y\n");
    assert_eq!(state_of(&st, &c), TrustState::Ask);
}

/// SEC-25 for names that aren't Unicode: such a file in a skill is still covered, by its bytes,
/// and such a skill is listed.
#[cfg(unix)]
#[test]
fn names_that_are_not_unicode_are_covered() {
    use std::os::unix::ffi::OsStrExt;
    let env = env();
    let c = course(&env, "STAT311");
    let odd = std::ffi::OsStr::from_bytes(b"run\xff.sh");
    let at = c.join(".lecter/skills/flashcards").join(odd);
    std::fs::write(&at, "echo one\n").unwrap_or_else(|e| panic!("{e}"));
    std::fs::create_dir_all(c.join(".lecter/skills").join(std::ffi::OsStr::from_bytes(b"q\xfe")))
        .unwrap_or_else(|e| panic!("{e}"));
    let st = store(&env);
    assert_eq!(reviewed(&st, &c).screen.skills, vec![".lecter/skills/flashcards", ".lecter/skills/q\u{FFFD}"]);
    trust(&st, &c, TrustChoice::Trusted);
    std::fs::write(&at, "echo two\n").unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(state_of(&st, &c), TrustState::Ask);
}
