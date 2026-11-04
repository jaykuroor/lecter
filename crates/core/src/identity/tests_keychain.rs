//! `migrate()` against a fake keychain (criterion 3): items under a legacy service are re-saved
//! under "lecter".

use super::tests_migrate::{FakeKeychain, OLD, base_for, run_on};
use super::{CURRENT, KeychainError, Leftover, Migration, Outcome, migrate};
use crate::paths::{AppDirs, Os};
use crate::testenv::TestEnv;

type Items = Vec<(String, String, Vec<u8>)>;

fn item(service: &str, account: &str, secret: &[u8]) -> (String, String, Vec<u8>) {
    (service.to_owned(), account.to_owned(), secret.to_vec())
}

/// Runs the migration from [`OLD`] with `kc` and the accounts `openai` and `gemini`.
fn migrate_with(kc: &FakeKeychain) -> super::Report {
    let env = TestEnv::new().unwrap();
    let base = base_for(Os::Linux, env.home());
    let dirs = AppDirs::derive(&CURRENT, Os::Linux, &base);
    match migrate(&run_on(Os::Linux, &base, &dirs, kc)) {
        Ok(Outcome::Ran(r)) => r,
        other => panic!("expected a run, got {other:?}"),
    }
}

#[test]
fn legacy_items_are_resaved_under_lecter_and_removed_from_the_old_service() {
    let kc = FakeKeychain::with(&[(OLD, "openai", b"sk-1"), (OLD, "gemini", b"g-2"), ("unrelated", "openai", b"u")]);
    let report = migrate_with(&kc);
    let want: Items =
        vec![item("lecter", "gemini", b"g-2"), item("lecter", "openai", b"sk-1"), item("unrelated", "openai", b"u")];
    assert_eq!(kc.snapshot(), want);
    assert_eq!(report.secrets, ["openai", "gemini"]);
    assert!(report.left.is_empty(), "{report:?}");
}

#[test]
fn the_target_service_is_the_stable_keychain_service_not_the_identifier() {
    let kc = FakeKeychain::with(&[(OLD, "openai", b"sk-1")]);
    migrate_with(&kc);
    let services: Vec<String> = kc.snapshot().into_iter().map(|(s, _, _)| s).collect();
    assert_eq!(services, ["lecter"]);
    assert_ne!(CURRENT.app_id, "lecter");
}

#[test]
fn accounts_with_nothing_saved_are_skipped() {
    let kc = FakeKeychain::with(&[(OLD, "gemini", b"g")]);
    let report = migrate_with(&kc);
    assert_eq!(report.secrets, ["gemini"]);
    assert_eq!(kc.snapshot(), [item("lecter", "gemini", b"g")]);
}

#[test]
fn an_item_already_under_lecter_is_kept_and_the_stale_legacy_copy_removed() {
    let kc = FakeKeychain::with(&[(OLD, "openai", b"old"), ("lecter", "openai", b"current")]);
    let report = migrate_with(&kc);
    assert_eq!(kc.snapshot(), [item("lecter", "openai", b"current")]);
    assert!(report.secrets.is_empty(), "nothing was re-saved: {report:?}");
}

#[test]
fn an_item_that_fails_to_save_stays_under_the_legacy_service_and_the_rest_move() {
    let kc = FakeKeychain {
        refuse_set: Some("openai"),
        ..FakeKeychain::with(&[(OLD, "openai", b"sk-1"), (OLD, "gemini", b"g-2")])
    };
    let report = migrate_with(&kc);
    assert_eq!(kc.snapshot(), [item(OLD, "openai", b"sk-1"), item("lecter", "gemini", b"g-2")]);
    assert_eq!(report.secrets, ["gemini"]);
    assert_eq!(
        report.left,
        [Leftover::Secret {
            service: OLD.to_owned(),
            account: "openai".to_owned(),
            reason: KeychainError::Failed("write refused".into())
        }]
    );
}

#[test]
fn every_legacy_service_is_migrated() {
    let env = TestEnv::new().unwrap();
    let base = base_for(Os::Linux, env.home());
    let dirs = AppDirs::derive(&CURRENT, Os::Linux, &base);
    let kc = FakeKeychain::with(&[("io.example.first", "openai", b"a"), ("io.example.second", "gemini", b"b")]);
    let m =
        Migration { legacy_ids: &["io.example.first", "io.example.second"], ..run_on(Os::Linux, &base, &dirs, &kc) };
    assert!(matches!(migrate(&m), Ok(Outcome::Ran(_))));
    assert_eq!(kc.snapshot(), [item("lecter", "gemini", b"b"), item("lecter", "openai", b"a")]);
}

#[test]
fn keychain_errors_never_carry_the_secret() {
    let kc = FakeKeychain { refuse_set: Some("openai"), ..FakeKeychain::with(&[(OLD, "openai", b"sk-secret-value")]) };
    let report = migrate_with(&kc);
    let shown = format!("{report:?} {}", KeychainError::Failed("write refused".into()));
    assert!(!shown.contains("sk-secret-value"), "{shown}");
}
