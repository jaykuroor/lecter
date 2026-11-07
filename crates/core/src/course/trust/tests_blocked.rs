//! F-033 criteria 2, 5 and 6 when the survey can't finish: more than MAX_ENTRIES skill entries, an
//! AI file over the hashed limit, a folder the OS won't let Lecter read. Such a course opens
//! read-only, can't be trusted, and every gated command gets E_NOT_TRUSTED (SEC-25, SEC-27).

#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::path::{Path, PathBuf};

use super::tests::{course, env, reviewed, state_of, store, trust, write};
use super::*;
use crate::ErrorCode;
use crate::course::{MAX_ENTRIES, open};
use crate::testenv::TestEnv;

const TOO_MANY: &str = ".lecter/skills/ holds more than 10000 entries.";

/// A course whose `.lecter/skills/` holds exactly MAX_ENTRIES entries: the skill folder and
/// MAX_ENTRIES - 1 files in it.
fn full_skills(env: &TestEnv) -> PathBuf {
    let c = env.home().join("Big");
    std::fs::create_dir_all(c.join("lectures")).unwrap_or_else(|e| panic!("{e}"));
    for i in 0..MAX_ENTRIES - 1 {
        write(&c, &format!(".lecter/skills/s/f{i:05}"), "");
    }
    c
}

/// The gate's error and its code, for a course that must not pass.
fn refused(st: &TrustStore, c: &Path) -> (Error, ErrorCode) {
    let e = require_trusted(st, c).err().unwrap_or_else(|| panic!("{} passed the gate", c.display()));
    let code = e.code();
    (e, code)
}

/// Exactly MAX_ENTRIES skill entries are surveyed; one more blocks trust but not read-only, and
/// the gate says E_NOT_TRUSTED, not a listing error.
#[test]
fn too_many_skill_entries_block_trust_but_not_read_only() {
    let env = env();
    let c = full_skills(&env);
    let st = store(&env);
    let r = reviewed(&st, &c);
    assert_eq!((r.state, r.screen.blocked), (TrustState::Ask, None));
    assert_eq!(r.screen.skills, vec![".lecter/skills/s".to_owned()]);
    write(&c, ".lecter/skills/s/one-more", "");
    let r = reviewed(&st, &c);
    assert_eq!((r.state, r.screen.blocked.as_deref()), (TrustState::Ask, Some(TOO_MANY)));
    assert!(r.screen.skills.is_empty() && r.screen.roles.is_empty(), "{:?}", r.screen);
    let path = open(&c).unwrap_or_else(|e| panic!("{e:?}")).path;
    assert_eq!(decide(&st, &path, TrustChoice::Trusted, &r.fingerprint), Err(Error::CourseNotTrusted));
    assert!(!st.file().exists(), "a refused answer was stored");
    assert_eq!(refused(&st, &c), (Error::CourseNotTrusted, ErrorCode::NotTrusted));
    assert_eq!(decide(&st, &path, TrustChoice::ReadOnly, &r.fingerprint), Ok(TrustState::ReadOnly));
    assert_eq!(state_of(&st, &c), TrustState::ReadOnly);
    assert_eq!(reviewed(&st, &c).state, TrustState::ReadOnly);
    assert_eq!(refused(&st, &c), (Error::CourseReadOnly, ErrorCode::NotTrusted));
}

/// A course trusted before its skills grew past the limit is no longer trusted: E_NOT_TRUSTED.
#[test]
fn a_trusted_course_whose_skills_grow_too_large_is_not_trusted() {
    let env = env();
    let c = full_skills(&env);
    let st = store(&env);
    trust(&st, &c, TrustChoice::Trusted);
    assert_eq!(require_trusted(&st, &c), Ok(()));
    write(&c, ".lecter/skills/s/one-more", "");
    assert_eq!(refused(&st, &c), (Error::CourseNotTrusted, ErrorCode::NotTrusted));
}

/// A `trusted.jsonc` that says "trusted" for a course that can't be surveyed (written by hand, or
/// by another build) trusts nothing.
#[test]
fn a_stored_trust_never_covers_a_blocked_course() {
    let env = env();
    let c = full_skills(&env);
    write(&c, ".lecter/skills/s/one-more", "");
    let st = store(&env);
    let path = open(&c).unwrap_or_else(|e| panic!("{e:?}")).path;
    st.set(&path, TrustEntry { choice: TrustChoice::Trusted, fingerprint: BLOCKED.to_owned() })
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(state_of(&st, &c), TrustState::Ask);
    assert_eq!(reviewed(&st, &c).state, TrustState::Ask);
    assert_eq!(refused(&st, &c), (Error::CourseNotTrusted, ErrorCode::NotTrusted));
}

/// Criterion 5 to the last byte: an AI file is hashed whole, so a same-length edit anywhere in it
/// asks again, up to the limit; a larger one blocks trust instead of being partly read.
#[test]
fn ai_files_are_hashed_whole_and_larger_ones_block_trust() {
    let limit = usize::try_from(survey::MAX_HASHED_BYTES).unwrap_or(usize::MAX);
    let env = env();
    let c = course(&env, "STAT311");
    let mut text = vec![b'a'; limit];
    std::fs::write(c.join("AGENTS.md"), &text).unwrap_or_else(|e| panic!("{e}"));
    let st = store(&env);
    trust(&st, &c, TrustChoice::Trusted);
    text[limit - 1] = b'b';
    std::fs::write(c.join("AGENTS.md"), &text).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(state_of(&st, &c), TrustState::Ask);
    trust(&st, &c, TrustChoice::Trusted);
    text.push(b'c');
    std::fs::write(c.join("AGENTS.md"), &text).unwrap_or_else(|e| panic!("{e}"));
    let r = reviewed(&st, &c);
    assert_eq!(r.screen.blocked.as_deref(), Some("AGENTS.md is larger than 16777216 bytes."));
    assert_eq!((r.state, refused(&st, &c).0), (TrustState::Ask, Error::CourseNotTrusted));
}

/// A `.lecter` folder the OS won't let Lecter look into blocks trust: its roles and skills can't
/// be listed, so they are never taken as absent. Read-only still opens.
#[cfg(unix)]
#[test]
fn an_unreadable_lecter_folder_blocks_trust_instead_of_looking_empty() {
    use std::os::unix::fs::PermissionsExt;
    let env = env();
    let c = env.home().join("Locked");
    std::fs::create_dir_all(c.join("lectures")).unwrap_or_else(|e| panic!("{e}"));
    // An empty folder, so the test home can still be removed if this test is killed.
    let locked = c.join(".lecter");
    std::fs::create_dir_all(&locked).unwrap_or_else(|e| panic!("{e}"));
    let listing = open(&c).unwrap_or_else(|e| panic!("{e:?}"));
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o600)).unwrap_or_else(|e| panic!("{e}"));
    if std::fs::symlink_metadata(locked.join("agents")).map(drop).map_err(|e| e.kind())
        != Err(std::io::ErrorKind::PermissionDenied)
    {
        // Running as root: permissions don't apply, so there is nothing to observe.
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap_or_else(|e| panic!("{e}"));
        return;
    }
    let st = store(&env);
    let r = review(&st, &listing, "sample");
    let read_only =
        r.as_ref().map(|r| decide(&st, &listing.path, TrustChoice::ReadOnly, &r.fingerprint)).map_err(Clone::clone);
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap_or_else(|e| panic!("{e}"));
    let r = r.unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(r.screen.blocked.as_deref(), Some("Lecter could not read that folder."));
    assert_eq!(read_only, Ok(Ok(TrustState::ReadOnly)));
}

/// F-045: a course that can't be surveyed any more isn't trusted again by Lecter's own settings
/// write, and nothing is stored.
#[test]
fn a_blocked_course_is_not_renewed() {
    let env = env();
    let c = full_skills(&env);
    let st = store(&env);
    trust(&st, &c, TrustChoice::Trusted);
    write(&c, ".lecter/skills/s/one-more", "");
    let before = std::fs::read_to_string(st.file()).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(renew_after_own_settings_write(&st, &c), Err(Error::CourseNotTrusted));
    assert_eq!(std::fs::read_to_string(st.file()).unwrap_or_else(|e| panic!("{e}")), before);
}
