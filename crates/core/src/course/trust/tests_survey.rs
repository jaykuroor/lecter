//! F-033 criteria 3 and 5: the stored answer stays in force while the course's AI files are as the
//! user saw them, and every change to them asks again (SEC-25), up to the edges of the survey:
//! the hashed window of a file, the list cap, hidden files and a folder the OS won't let it read.

#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use super::tests::{course, env, reviewed, state_of, store, trust, write};
use super::*;

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
