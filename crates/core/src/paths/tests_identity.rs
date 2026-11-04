//! The folder table against the real environment, and the folders' independence from the bundle
//! identifier (`01-architecture.md#app-identity-and-migration`).

use std::path::{Path, PathBuf};

use super::{AppDirs, BaseDirs, Os};
use crate::identity::{self, Identity, KEYCHAIN_SERVICE};

fn all(d: &AppDirs) -> [PathBuf; 3] {
    [d.config().to_path_buf(), d.data().to_path_buf(), d.cache().to_path_buf()]
}

fn base(root: &str, xdg: Option<&str>) -> BaseDirs {
    let r = PathBuf::from(root);
    BaseDirs {
        home: r.join("home"),
        xdg_config_home: xdg.map(PathBuf::from),
        config: r.join("cfg"),
        data: r.join("data"),
        data_local: r.join("local"),
        cache: r.join("cache"),
    }
}

/// `CURRENT` with another bundle identifier, as after a rename.
const fn renamed(app_id: &'static str) -> Identity {
    Identity { app_id, ..identity::CURRENT }
}

#[test]
fn changing_app_id_moves_no_folder_and_no_keychain_service() {
    let others = [renamed("io.example.renamed"), renamed("com.other.lecter-next")];
    for os in [Os::Linux, Os::MacOs, Os::Windows] {
        for b in [base("/r", None), base("/r", Some("/xdg"))] {
            let now = AppDirs::derive(&identity::CURRENT, os, &b);
            assert_eq!(AppDirs::for_os(os, &b), now, "{os:?}: for_os is the current identity's folders");
            for id in others {
                assert_eq!(AppDirs::derive(&id, os, &b), now, "{os:?}: {} moved the folders", id.app_id);
                assert_eq!(id.keychain_service, KEYCHAIN_SERVICE, "{} moved the keychain service", id.app_id);
                for p in all(&AppDirs::derive(&id, os, &b)) {
                    assert!(!p.to_string_lossy().contains(id.app_id), "{}", p.display());
                }
            }
        }
    }
}

#[test]
fn the_folder_name_comes_from_dir_name() {
    let other = Identity { dir_name: "elsewhere", ..identity::CURRENT };
    let d = AppDirs::derive(&other, Os::Windows, &base("/r", None));
    let want = [
        PathBuf::from("/r/cfg/elsewhere"),
        PathBuf::from("/r/local/elsewhere/data"),
        "/r/local/elsewhere/cache".into(),
    ];
    assert_eq!(all(&d), want);
    let mac = AppDirs::derive(&other, Os::MacOs, &base("/r", None));
    assert_eq!(mac.config(), Path::new("/r/home/.config/elsewhere"));
    assert_eq!(AppDirs::derive(&other, Os::Linux, &base("/r", None)).cache(), Path::new("/r/cache/elsewhere"));
}

/// `AppDirs::resolve()` in a child copy of this test binary (the child half is
/// `paths::tests::resolve_in_child_process`) with `envs` set and `removed` unset, and no test
/// home, so no test changes its own process environment.
#[cfg(any(debug_assertions, feature = "test-hooks"))]
fn resolve_in_child(envs: &[(&str, &Path)], removed: &[&str]) -> Vec<PathBuf> {
    let mut cmd = std::process::Command::new(std::env::current_exe().expect("test binary"));
    cmd.env(super::tests::CHILD_MARK, "1").env_remove(super::TEST_HOME_VAR).args([
        "--exact",
        "paths::tests::resolve_in_child_process",
        "--nocapture",
        "--test-threads=1",
    ]);
    for k in removed {
        cmd.env_remove(k);
    }
    for (k, v) in envs {
        cmd.env(k, v);
    }
    let out = cmd.output().expect("child runs");
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(out.status.success(), "child failed:\n{text}\n{}", String::from_utf8_lossy(&out.stderr));
    text.lines().filter_map(|l| l.split_once("RESOLVED ").map(|(_, p)| PathBuf::from(p))).collect()
}

/// Criterion 1 end to end on Linux and macOS: the `directories` crate's folders for a home,
/// through `resolve()`.
#[cfg(all(not(windows), any(debug_assertions, feature = "test-hooks")))]
#[test]
#[allow(clippy::disallowed_methods, reason = "a test makes its fake home on a plain test thread")]
fn the_real_folders_follow_the_table() {
    let env = crate::testenv::TestEnv::new().expect("temp dir");
    let home = env.home().join("user home");
    std::fs::create_dir_all(&home).expect("mkdir");
    let xdg = env.home().join("xdg config");
    let unset = ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME"];
    let (data, cache) = if cfg!(target_os = "macos") {
        (home.join("Library/Application Support/lecter"), home.join("Library/Caches/lecter"))
    } else {
        (home.join(".local/share/lecter"), home.join(".cache/lecter"))
    };

    let plain = resolve_in_child(&[("HOME", &home)], &unset);
    assert_eq!(plain, [home.join(".config/lecter"), data.clone(), cache.clone()]);

    let with_xdg = resolve_in_child(&[("HOME", &home), ("XDG_CONFIG_HOME", &xdg)], &unset[1..]);
    assert_eq!(with_xdg, [xdg.join("lecter"), data.clone(), cache.clone()], "$XDG_CONFIG_HOME/lecter");

    // The XDG spec ignores a relative value; so does Lecter.
    let relative = resolve_in_child(&[("HOME", &home), ("XDG_CONFIG_HOME", Path::new("rel/cfg"))], &unset[1..]);
    assert_eq!(relative, [home.join(".config/lecter"), data, cache]);
}

/// Criterion 1 on Windows: `%APPDATA%\lecter`, `%LOCALAPPDATA%\lecter\data` and `\cache`.
#[cfg(all(windows, any(debug_assertions, feature = "test-hooks")))]
#[test]
fn the_real_folders_follow_the_table() {
    let got = resolve_in_child(&[], &[]);
    let appdata = PathBuf::from(std::env::var_os("APPDATA").expect("APPDATA"));
    let local = PathBuf::from(std::env::var_os("LOCALAPPDATA").expect("LOCALAPPDATA")).join("lecter");
    assert_eq!(got, [appdata.join("lecter"), local.join("data"), local.join("cache")]);
}
