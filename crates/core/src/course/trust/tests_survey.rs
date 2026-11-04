//! F-033 criteria 3 and 5: the stored answer stays in force while the course's AI files are as the
//! user saw them, and every change to them asks again (SEC-25), up to the edges of the survey:
//! the hashed window of a file, the list cap, hidden files and a folder the OS won't let it read.

#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

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

/// Criterion 5: an edit that keeps a file's length still asks again, even in the last byte the
/// fingerprint reads (16 MiB into the file).
#[test]
fn a_same_length_edit_at_the_end_of_the_hashed_window_asks_again() {
    const WINDOW: usize = 16 * 1024 * 1024;
    let env = env();
    let c = course(&env, "STAT311");
    let mut text = vec![b'a'; WINDOW];
    std::fs::write(c.join("AGENTS.md"), &text).unwrap_or_else(|e| panic!("{e}"));
    let st = store(&env);
    trust(&st, &c, TrustChoice::Trusted);
    text[WINDOW - 1] = b'b';
    std::fs::write(c.join("AGENTS.md"), &text).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(state_of(&st, &c), TrustState::Ask);
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

/// A `.lecter` folder the OS won't let Lecter look into fails the review: its roles and skills
/// can't be listed, so they are never taken as absent.
#[cfg(unix)]
#[test]
fn an_unreadable_lecter_folder_fails_the_review_instead_of_looking_empty() {
    use std::os::unix::fs::PermissionsExt;
    let env = env();
    let c = env.home().join("Locked");
    std::fs::create_dir_all(c.join("lectures")).unwrap_or_else(|e| panic!("{e}"));
    // An empty folder, so the test home can still be removed if this test is killed.
    let locked = c.join(".lecter");
    std::fs::create_dir_all(&locked).unwrap_or_else(|e| panic!("{e}"));
    let listing = crate::course::open(&c).unwrap_or_else(|e| panic!("{e:?}"));
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o600)).unwrap_or_else(|e| panic!("{e}"));
    if std::fs::symlink_metadata(locked.join("agents")).map(drop).map_err(|e| e.kind())
        != Err(std::io::ErrorKind::PermissionDenied)
    {
        // Running as root: permissions don't apply, so there is nothing to observe.
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap_or_else(|e| panic!("{e}"));
        return;
    }
    let result = review(&store(&env), &listing, "sample").map(|r| r.screen);
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(result, Err(Error::Io(std::io::ErrorKind::PermissionDenied)));
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

/// The skills walk looks at MAX_ENTRIES entries in all, then fails rather than skip the rest.
#[test]
fn the_skills_walk_stops_past_max_entries() {
    let env = env();
    let c = env.home().join("Big");
    std::fs::create_dir_all(c.join("lectures")).unwrap_or_else(|e| panic!("{e}"));
    // The skill folder itself and MAX_ENTRIES - 1 files in it: MAX_ENTRIES entries.
    for i in 0..MAX_ENTRIES - 1 {
        write(&c, &format!(".lecter/skills/s/f{i:05}"), "");
    }
    let st = store(&env);
    assert_eq!(reviewed(&st, &c).screen.skills, vec![".lecter/skills/s".to_owned()]);
    write(&c, ".lecter/skills/s/one-more", "");
    let listing = crate::course::open(&c).unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(
        review(&st, &listing, "sample").map(|r| r.screen),
        Err(Error::TooManyEntries { folder: ".lecter/skills", limit: MAX_ENTRIES })
    );
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
