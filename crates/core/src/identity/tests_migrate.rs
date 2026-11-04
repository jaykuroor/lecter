//! `migrate()` against a temp home: folders (criterion 1) and the once-only record (criterion 2).
#![allow(clippy::disallowed_methods, reason = "tests set up files on plain test threads")]

use std::path::Path;
use std::sync::Mutex;

use super::{
    CURRENT, Identity, Keychain, KeychainError, LeftReason, Leftover, MIGRATED_KEY, MigrateError, Migration, Outcome,
    STATE_DB, migrate,
};
use crate::paths::{AppDirs, BaseDirs, Os};
use crate::testenv::TestEnv;

pub(super) const OLD: &str = "io.example.old-lecter";

/// The OS base folders under `root`, laid out as the `directories` crate reports them on `os`.
pub(super) fn base_for(os: Os, root: &Path) -> BaseDirs {
    let (config, data, data_local, cache) = match os {
        Os::Linux => (root.join(".config"), root.join(".local/share"), root.join(".local/share"), root.join(".cache")),
        Os::MacOs => {
            let support = root.join("Library/Application Support");
            (support.clone(), support.clone(), support, root.join("Library/Caches"))
        }
        Os::Windows => {
            let (roaming, local) = (root.join("AppData/Roaming"), root.join("AppData/Local"));
            (roaming.clone(), roaming, local.clone(), local)
        }
    };
    BaseDirs { home: root.to_path_buf(), xdg_config_home: None, config, data, data_local, cache }
}

/// An in-memory OS keychain.
#[derive(Default)]
pub(super) struct FakeKeychain {
    pub items: Mutex<Vec<(String, String, Vec<u8>)>>,
    /// Every call fails as if no keychain could be reached.
    pub unavailable: bool,
    /// Saving this account fails.
    pub refuse_set: Option<&'static str>,
    pub calls: Mutex<usize>,
}

impl FakeKeychain {
    pub fn with(items: &[(&str, &str, &[u8])]) -> Self {
        let items = items.iter().map(|(s, a, v)| ((*s).to_owned(), (*a).to_owned(), v.to_vec())).collect();
        Self { items: Mutex::new(items), ..Self::default() }
    }

    pub fn snapshot(&self) -> Vec<(String, String, Vec<u8>)> {
        let mut v = self.items.lock().unwrap().clone();
        v.sort();
        v
    }

    fn call(&self) -> Result<(), KeychainError> {
        *self.calls.lock().unwrap() += 1;
        if self.unavailable { Err(KeychainError::Unavailable) } else { Ok(()) }
    }
}

impl Keychain for FakeKeychain {
    fn get(&self, service: &str, account: &str) -> Result<Option<Vec<u8>>, KeychainError> {
        self.call()?;
        let items = self.items.lock().unwrap();
        Ok(items.iter().find(|(s, a, _)| s == service && a == account).map(|(_, _, v)| v.clone()))
    }

    fn set(&self, service: &str, account: &str, secret: &[u8]) -> Result<(), KeychainError> {
        self.call()?;
        if self.refuse_set == Some(account) {
            return Err(KeychainError::Failed("write refused".into()));
        }
        let mut items = self.items.lock().unwrap();
        items.retain(|(s, a, _)| !(s == service && a == account));
        items.push((service.to_owned(), account.to_owned(), secret.to_vec()));
        Ok(())
    }

    fn delete(&self, service: &str, account: &str) -> Result<(), KeychainError> {
        self.call()?;
        self.items.lock().unwrap().retain(|(s, a, _)| !(s == service && a == account));
        Ok(())
    }
}

pub(super) fn put(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn text(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// A migration from [`OLD`] to `CURRENT` on `os`, under `base`, with `kc`.
pub(super) fn run_on<'a>(os: Os, base: &'a BaseDirs, dirs: &'a AppDirs, kc: &'a FakeKeychain) -> Migration<'a> {
    Migration { current: CURRENT, legacy_ids: &[OLD], os, base, dirs, keychain: kc, accounts: &["openai", "gemini"] }
}

fn ran(out: Result<Outcome, MigrateError>) -> super::Report {
    match out {
        Ok(Outcome::Ran(r)) => r,
        other => panic!("expected a run, got {other:?}"),
    }
}

fn recorded(dirs: &AppDirs) -> Option<String> {
    let conn = rusqlite::Connection::open(dirs.data().join("state.db")).unwrap();
    conn.query_row("SELECT value FROM meta WHERE key = 'migrated_identity'", [], |r| r.get(0)).ok()
}

#[test]
fn linux_legacy_folders_move_into_the_lecter_folders_and_webview_storage_is_dropped() {
    let env = TestEnv::new().unwrap();
    let h = env.home();
    let base = base_for(Os::Linux, h);
    let dirs = AppDirs::derive(&CURRENT, Os::Linux, &base);
    put(&h.join(".config").join(OLD).join("plugin.json"), "cfg");
    put(&h.join(".local/share").join(OLD).join("window-state.json"), "data");
    put(&h.join(".local/share").join(OLD).join("deep/a/b.txt"), "deep");
    put(&h.join(".local/share").join(OLD).join("WebKitCache/Version 16/x"), "webview");
    put(&h.join(".local/share").join(OLD).join("hsts-storage.sqlite"), "webview");
    put(&h.join(".local/share").join(OLD).join("storage/y"), "webview");
    put(&h.join(".cache").join(OLD).join("thumbs/a.png"), "cache");
    let kc = FakeKeychain::default();

    let report = ran(migrate(&run_on(Os::Linux, &base, &dirs, &kc)));

    // The table in 01-architecture.md: ~/.config/lecter, ~/.local/share/lecter, ~/.cache/lecter.
    assert_eq!(text(&h.join(".config/lecter/plugin.json")), "cfg");
    assert_eq!(text(&h.join(".local/share/lecter/window-state.json")), "data");
    assert_eq!(text(&h.join(".local/share/lecter/deep/a/b.txt")), "deep");
    assert_eq!(text(&h.join(".cache/lecter/thumbs/a.png")), "cache");
    for gone in ["WebKitCache", "hsts-storage.sqlite", "storage"] {
        assert!(!h.join(".local/share/lecter").join(gone).exists(), "{gone} was moved, not discarded");
    }
    for root in [".config", ".local/share", ".cache"] {
        assert!(!h.join(root).join(OLD).exists(), "{root}/{OLD} is still there");
    }
    assert_eq!(report.discarded.len(), 3, "{report:?}");
    assert_eq!(report.moved.len(), 4, "{report:?}");
    assert!(report.left.is_empty(), "{report:?}");
}

#[test]
fn macos_legacy_folders_move_and_the_webkit_stores_are_dropped() {
    let env = TestEnv::new().unwrap();
    let h = env.home();
    let base = base_for(Os::MacOs, h);
    let dirs = AppDirs::derive(&CURRENT, Os::MacOs, &base);
    put(&h.join("Library/Application Support").join(OLD).join("state.json"), "data");
    put(&h.join("Library/Caches").join(OLD).join("t.bin"), "cache");
    put(&h.join("Library/Caches").join(OLD).join("WebKit/NetworkCache/x"), "webview");
    put(&h.join("Library/WebKit").join(OLD).join("WebsiteData/LocalStorage/x"), "webview");
    put(&h.join("Library/HTTPStorages").join(OLD).join("httpstorages.sqlite"), "webview");
    let kc = FakeKeychain::default();

    ran(migrate(&run_on(Os::MacOs, &base, &dirs, &kc)));

    assert_eq!(text(&h.join("Library/Application Support/lecter/state.json")), "data");
    assert_eq!(text(&h.join("Library/Caches/lecter/t.bin")), "cache");
    assert!(!h.join("Library/Caches/lecter/WebKit").exists());
    for gone in ["Application Support", "Caches", "WebKit", "HTTPStorages"] {
        assert!(!h.join("Library").join(gone).join(OLD).exists(), "Library/{gone}/{OLD} is still there");
    }
    assert!(!h.join(".config/lecter").exists(), "nothing belonged in the config folder");
}

#[test]
fn windows_legacy_folders_move_to_local_lecter_data_and_ebwebview_is_dropped() {
    let env = TestEnv::new().unwrap();
    let h = env.home();
    let base = base_for(Os::Windows, h);
    let dirs = AppDirs::derive(&CURRENT, Os::Windows, &base);
    put(&h.join("AppData/Roaming").join(OLD).join("a.json"), "roaming");
    put(&h.join("AppData/Local").join(OLD).join("b.bin"), "local");
    put(&h.join("AppData/Local").join(OLD).join("EBWebView/Default/x"), "webview");
    let kc = FakeKeychain::default();

    ran(migrate(&run_on(Os::Windows, &base, &dirs, &kc)));

    // %LOCALAPPDATA%\lecter\data
    assert_eq!(text(&h.join("AppData/Local/lecter/data/a.json")), "roaming");
    assert_eq!(text(&h.join("AppData/Local/lecter/data/b.bin")), "local");
    assert!(!h.join("AppData/Local/lecter/data/EBWebView").exists());
    assert!(!h.join("AppData/Local").join(OLD).exists());
    assert!(!h.join("AppData/Roaming").join(OLD).exists());
}

#[test]
fn the_stable_copy_wins_a_clash_and_the_legacy_one_stays_put() {
    let env = TestEnv::new().unwrap();
    let h = env.home();
    let base = base_for(Os::Linux, h);
    let dirs = AppDirs::derive(&CURRENT, Os::Linux, &base);
    let legacy = h.join(".local/share").join(OLD);
    put(&legacy.join("clash.json"), "old");
    put(&dirs.data().join("clash.json"), "new");
    put(&legacy.join("shared/from-old.txt"), "o");
    put(&dirs.data().join("shared/from-new.txt"), "n");
    put(&legacy.join("file-vs-dir"), "old file");
    put(&dirs.data().join("file-vs-dir/inner"), "new dir");
    let kc = FakeKeychain::default();

    let report = ran(migrate(&run_on(Os::Linux, &base, &dirs, &kc)));

    assert_eq!(text(&dirs.data().join("clash.json")), "new");
    assert_eq!(text(&legacy.join("clash.json")), "old", "a clashing legacy file is never deleted");
    assert_eq!(text(&dirs.data().join("shared/from-old.txt")), "o", "folders merge");
    assert_eq!(text(&dirs.data().join("shared/from-new.txt")), "n");
    assert!(!legacy.join("shared").exists(), "a merged folder is emptied and removed");
    assert_eq!(text(&legacy.join("file-vs-dir")), "old file");
    assert_eq!(text(&dirs.data().join("file-vs-dir/inner")), "new dir");
    let mut left: Vec<_> = report.left.clone();
    left.sort_by_key(|l| format!("{l:?}"));
    assert_eq!(
        left,
        [
            Leftover::Path {
                path: legacy.join("clash.json"),
                reason: LeftReason::Conflict(dirs.data().join("clash.json"))
            },
            Leftover::Path {
                path: legacy.join("file-vs-dir"),
                reason: LeftReason::Conflict(dirs.data().join("file-vs-dir"))
            },
        ]
    );
    assert!(legacy.is_dir(), "a legacy folder with something left in it is kept");
}

#[test]
fn webview_names_outside_the_webview_folder_are_moved_not_dropped() {
    let env = TestEnv::new().unwrap();
    let h = env.home();
    let base = base_for(Os::Linux, h);
    let dirs = AppDirs::derive(&CURRENT, Os::Linux, &base);
    put(&h.join(".config").join(OLD).join("storage/kept"), "cfg");
    let kc = FakeKeychain::default();
    ran(migrate(&run_on(Os::Linux, &base, &dirs, &kc)));
    assert_eq!(text(&h.join(".config/lecter/storage/kept")), "cfg");
}

#[cfg(unix)]
#[test]
fn a_linked_legacy_folder_is_not_followed_and_links_inside_move_as_links() {
    let env = TestEnv::new().unwrap();
    let h = env.home();
    let base = base_for(Os::Linux, h);
    let dirs = AppDirs::derive(&CURRENT, Os::Linux, &base);
    let outside = h.join("outside");
    put(&outside.join("precious.txt"), "mine");
    std::fs::create_dir_all(h.join(".config")).unwrap();
    std::os::unix::fs::symlink(&outside, h.join(".config").join(OLD)).unwrap();
    let data = h.join(".local/share").join(OLD);
    std::fs::create_dir_all(&data).unwrap();
    std::os::unix::fs::symlink(&outside, data.join("link")).unwrap();
    let kc = FakeKeychain::default();

    let report = ran(migrate(&run_on(Os::Linux, &base, &dirs, &kc)));

    assert_eq!(text(&outside.join("precious.txt")), "mine");
    assert!(!dirs.config().join("precious.txt").exists(), "followed a linked legacy folder");
    assert!(
        report.left.contains(&Leftover::Path { path: h.join(".config").join(OLD), reason: LeftReason::NotAFolder })
    );
    let moved = dirs.data().join("link");
    assert!(std::fs::symlink_metadata(&moved).unwrap().file_type().is_symlink());
    assert_eq!(std::fs::read_link(&moved).unwrap(), outside);
}

#[test]
fn a_legacy_folder_holding_a_stable_folder_is_never_touched() {
    let env = TestEnv::new().unwrap();
    let h = env.home();
    let base = base_for(Os::Linux, h);
    // The stable data folder sits inside the legacy one: emptying it would move it into itself.
    let dirs = AppDirs::at(&h.join(".local/share").join(OLD));
    put(&h.join(".local/share").join(OLD).join("x.txt"), "x");
    let kc = FakeKeychain::default();
    ran(migrate(&run_on(Os::Linux, &base, &dirs, &kc)));
    assert_eq!(text(&h.join(".local/share").join(OLD).join("x.txt")), "x");
}

#[test]
fn bad_legacy_identifiers_are_refused_before_anything_is_touched() {
    let env = TestEnv::new().unwrap();
    let base = base_for(Os::Linux, env.home());
    let dirs = AppDirs::derive(&CURRENT, Os::Linux, &base);
    let kc = FakeKeychain::default();
    for bad in ["", ".", "..", "a/b", "a\\b", "/abs", "C:x", "lecter", "Lecter", CURRENT.app_id] {
        let m = Migration { legacy_ids: &[OLD, bad], ..run_on(Os::Linux, &base, &dirs, &kc) };
        assert_eq!(migrate(&m), Err(MigrateError::BadLegacyId(bad.to_owned())), "{bad:?}");
    }
    assert!(!dirs.data().exists(), "a refused run created the data folder");
    assert_eq!(*kc.calls.lock().unwrap(), 0);
}

#[test]
fn no_legacy_identifier_touches_nothing() {
    let env = TestEnv::new().unwrap();
    let base = base_for(Os::Linux, env.home());
    let dirs = AppDirs::derive(&CURRENT, Os::Linux, &base);
    let kc = FakeKeychain::default();
    let m = Migration { legacy_ids: &[], ..run_on(Os::Linux, &base, &dirs, &kc) };
    assert_eq!(migrate(&m), Ok(Outcome::NothingToMigrate));
    assert!(!dirs.data().exists());
    assert_eq!(*kc.calls.lock().unwrap(), 0);
    let host = Migration::for_host(&base, &dirs, &kc, &[]);
    assert_eq!((host.current, host.legacy_ids, host.os), (CURRENT, super::LEGACY_APP_IDS, Os::host()));
}

#[test]
fn it_runs_once_and_records_the_identity_in_state_db_meta() {
    let env = TestEnv::new().unwrap();
    let h = env.home();
    let base = base_for(Os::Linux, h);
    let dirs = AppDirs::derive(&CURRENT, Os::Linux, &base);
    let legacy = h.join(".local/share").join(OLD);
    put(&legacy.join("first.txt"), "1");
    let kc = FakeKeychain::default();

    ran(migrate(&run_on(Os::Linux, &base, &dirs, &kc)));
    assert_eq!((STATE_DB, MIGRATED_KEY), ("state.db", "migrated_identity"));
    assert_eq!(recorded(&dirs).as_deref(), Some(CURRENT.app_id));
    assert_eq!(text(&dirs.data().join("first.txt")), "1");

    // Something appears under the legacy name again: a recorded run doesn't look.
    put(&legacy.join("second.txt"), "2");
    let calls = *kc.calls.lock().unwrap();
    assert_eq!(migrate(&run_on(Os::Linux, &base, &dirs, &kc)), Ok(Outcome::AlreadyDone));
    assert_eq!(text(&legacy.join("second.txt")), "2");
    assert!(!dirs.data().join("second.txt").exists());
    assert_eq!(*kc.calls.lock().unwrap(), calls, "a recorded run touched the keychain");
}

#[test]
fn the_record_is_per_identity_so_a_later_rename_migrates_again() {
    let env = TestEnv::new().unwrap();
    let h = env.home();
    let base = base_for(Os::Linux, h);
    let dirs = AppDirs::derive(&CURRENT, Os::Linux, &base);
    let kc = FakeKeychain::default();
    ran(migrate(&run_on(Os::Linux, &base, &dirs, &kc)));

    // The next rename: the current identifier becomes legacy too.
    let next = Identity { app_id: "io.example.next", ..CURRENT };
    put(&h.join(".config").join(CURRENT.app_id).join("p.json"), "p");
    let m = Migration { current: next, legacy_ids: &[OLD, CURRENT.app_id], ..run_on(Os::Linux, &base, &dirs, &kc) };
    ran(migrate(&m));
    assert_eq!(text(&dirs.config().join("p.json")), "p");
    assert_eq!(recorded(&dirs).as_deref(), Some("io.example.next"));
    assert_eq!(migrate(&m), Ok(Outcome::AlreadyDone));
}

#[test]
fn other_meta_rows_survive_and_the_database_is_in_wal_mode() {
    let env = TestEnv::new().unwrap();
    let base = base_for(Os::Linux, env.home());
    let dirs = AppDirs::derive(&CURRENT, Os::Linux, &base);
    std::fs::create_dir_all(dirs.data()).unwrap();
    let conn = rusqlite::Connection::open(dirs.data().join("state.db")).unwrap();
    conn.execute_batch(
        "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); INSERT INTO meta VALUES ('created', '1');",
    )
    .unwrap();
    drop(conn);
    let kc = FakeKeychain::default();
    ran(migrate(&run_on(Os::Linux, &base, &dirs, &kc)));
    let conn = rusqlite::Connection::open(dirs.data().join("state.db")).unwrap();
    let created: String = conn.query_row("SELECT value FROM meta WHERE key = 'created'", [], |r| r.get(0)).unwrap();
    assert_eq!(created, "1");
    let mode: String = conn.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
    assert_eq!(mode, "wal");
}

#[test]
fn an_unreachable_keychain_moves_nothing_records_nothing_and_retries_next_start() {
    let env = TestEnv::new().unwrap();
    let h = env.home();
    let base = base_for(Os::Linux, h);
    let dirs = AppDirs::derive(&CURRENT, Os::Linux, &base);
    put(&h.join(".config").join(OLD).join("plugin.json"), "cfg");
    let locked = FakeKeychain { unavailable: true, ..FakeKeychain::default() };
    assert_eq!(migrate(&run_on(Os::Linux, &base, &dirs, &locked)), Err(MigrateError::KeychainUnavailable));
    assert!(h.join(".config").join(OLD).join("plugin.json").exists());
    assert_eq!(recorded(&dirs), None);

    let open = FakeKeychain::with(&[(OLD, "openai", b"sk-1")]);
    let report = ran(migrate(&run_on(Os::Linux, &base, &dirs, &open)));
    assert_eq!(report.secrets, ["openai"]);
    assert_eq!(text(&dirs.config().join("plugin.json")), "cfg");
}

#[test]
fn a_state_db_that_is_not_a_database_is_an_error_and_nothing_moves() {
    let env = TestEnv::new().unwrap();
    let h = env.home();
    let base = base_for(Os::Linux, h);
    let dirs = AppDirs::derive(&CURRENT, Os::Linux, &base);
    put(&dirs.data().join("state.db"), "this is not sqlite, it is long enough to have a header page");
    put(&h.join(".config").join(OLD).join("plugin.json"), "cfg");
    let kc = FakeKeychain::default();
    let got = migrate(&run_on(Os::Linux, &base, &dirs, &kc));
    assert!(matches!(got, Err(MigrateError::StateDb(_))), "{got:?}");
    assert!(h.join(".config").join(OLD).join("plugin.json").exists());
}

#[test]
fn two_starts_at_once_migrate_once() {
    let env = TestEnv::new().unwrap();
    let h = env.home();
    let base = base_for(Os::Linux, h);
    let dirs = AppDirs::derive(&CURRENT, Os::Linux, &base);
    for i in 0..50 {
        put(&h.join(".local/share").join(OLD).join(format!("f{i}")), "x");
    }
    let outcomes: Vec<Outcome> = std::thread::scope(|s| {
        let handles: Vec<_> = (0..4)
            .map(|_| {
                s.spawn(|| {
                    let kc = FakeKeychain::default();
                    migrate(&run_on(Os::Linux, &base, &dirs, &kc)).unwrap()
                })
            })
            .collect();
        handles.into_iter().map(|j| j.join().unwrap()).collect()
    });
    let runs: Vec<usize> = outcomes
        .iter()
        .filter_map(|o| match o {
            Outcome::Ran(r) => Some(r.moved.len()),
            _ => None,
        })
        .collect();
    assert_eq!(runs, [50], "exactly one run moved everything: {outcomes:?}");
    assert_eq!(outcomes.iter().filter(|o| **o == Outcome::AlreadyDone).count(), 3);
}

/// The paths a run moved are where the entries now are.
#[test]
fn the_report_names_the_new_locations() {
    let env = TestEnv::new().unwrap();
    let h = env.home();
    let base = base_for(Os::Linux, h);
    let dirs = AppDirs::derive(&CURRENT, Os::Linux, &base);
    put(&h.join(".cache").join(OLD).join("c"), "c");
    let kc = FakeKeychain::default();
    let report = ran(migrate(&run_on(Os::Linux, &base, &dirs, &kc)));
    assert_eq!(report.moved, [h.join(".cache/lecter/c")]);
}
