//! First-run detection (`12-settings-theme-onboarding.md`, "Onboarding"):
//! no global `config.jsonc` means Lecter has never been set up here, so onboarding is due.
//!
//! The file, not the folder, decides: the settings watcher creates the config folder on every
//! start (D-175), and onboarding's choices are saved in `config.jsonc`.

use std::path::PathBuf;

use super::AppDirs;
use crate::settings::GLOBAL_FILE;

/// Whether this start is the first one on this machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunState {
    /// No global config exists: onboarding is due.
    FirstRun,
    /// A global config exists, even a broken one (the settings report its problems).
    Returning,
}

impl RunState {
    /// Whether onboarding should open.
    pub const fn needs_onboarding(self) -> bool {
        matches!(self, Self::FirstRun)
    }
}

impl AppDirs {
    /// The global settings file, `config.jsonc` in the config folder.
    pub fn global_config_file(&self) -> PathBuf {
        self.config.join(GLOBAL_FILE)
    }

    /// Detects a first run. Call it once at startup, before anything saves a setting. Reads only
    /// the file's metadata and creates nothing. A file that can't be inspected for any reason
    /// other than being absent counts as existing, so a setup with a problem is never mistaken
    /// for a new one.
    #[allow(clippy::disallowed_methods, reason = "one metadata read at startup, on a blocking thread")]
    pub fn run_state(&self) -> RunState {
        match std::fs::metadata(self.global_config_file()) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => RunState::FirstRun,
            _ => RunState::Returning,
        }
    }
}

#[cfg(test)]
#[allow(clippy::disallowed_methods, reason = "tests set up files on plain test threads")]
mod tests {
    use std::sync::Arc;

    use super::RunState;
    use crate::settings::{Scope, SettingsStore, SettingsWatcher};
    use crate::testenv::TestEnv;

    fn env() -> TestEnv {
        TestEnv::new().expect("test home")
    }

    #[test]
    fn an_empty_home_is_a_first_run_and_flags_onboarding() {
        let env = env();
        let dirs = env.dirs();
        assert_eq!(dirs.run_state(), RunState::FirstRun);
        assert!(dirs.run_state().needs_onboarding());
        assert!(!dirs.config().exists(), "detection created the config folder");
    }

    #[test]
    fn a_global_config_file_means_returning_and_no_onboarding() {
        let env = env();
        let dirs = env.dirs();
        std::fs::create_dir_all(dirs.config()).expect("mkdir");
        std::fs::write(dirs.config().join("config.jsonc"), "{}").expect("write");
        assert_eq!(dirs.run_state(), RunState::Returning);
        assert!(!dirs.run_state().needs_onboarding());
    }

    #[test]
    fn an_empty_or_broken_config_still_counts_as_set_up() {
        for text in ["", "{ \"ui\": { broken", "\u{0}\u{1}"] {
            let env = env();
            let dirs = env.dirs();
            std::fs::create_dir_all(dirs.config()).expect("mkdir");
            std::fs::write(dirs.global_config_file(), text).expect("write");
            assert_eq!(dirs.run_state(), RunState::Returning, "{text:?}");
        }
    }

    #[test]
    fn a_config_folder_without_config_jsonc_is_still_a_first_run() {
        let env = env();
        let dirs = env.dirs();
        std::fs::create_dir_all(dirs.config()).expect("mkdir");
        for other in ["keymaps.jsonc", "trusted.jsonc", "config.jsonc.tmp", "Config.jsonc.bak", "memory.md"] {
            std::fs::write(dirs.config().join(other), "{}").expect("write");
        }
        assert_eq!(dirs.run_state(), RunState::FirstRun);
    }

    #[test]
    fn config_jsonc_in_the_data_or_cache_folder_does_not_count() {
        let env = env();
        let dirs = env.dirs();
        for dir in [dirs.data(), dirs.cache()] {
            std::fs::create_dir_all(dir).expect("mkdir");
            std::fs::write(dir.join("config.jsonc"), "{}").expect("write");
        }
        assert_eq!(dirs.run_state(), RunState::FirstRun);
    }

    #[cfg(unix)]
    #[test]
    fn a_dangling_link_is_a_first_run_and_a_live_link_is_not() {
        let env = env();
        let dirs = env.dirs();
        std::fs::create_dir_all(dirs.config()).expect("mkdir");
        let target = env.home().join("elsewhere.jsonc");
        std::os::unix::fs::symlink(&target, dirs.global_config_file()).expect("symlink");
        assert_eq!(dirs.run_state(), RunState::FirstRun, "the settings read a dangling link as no file");
        std::fs::write(&target, "{}").expect("write");
        assert_eq!(dirs.run_state(), RunState::Returning);
    }

    #[test]
    fn detection_checks_the_file_the_settings_read_and_write() {
        let env = env();
        let dirs = env.dirs();
        let store = SettingsStore::open(&dirs, None);
        assert_eq!(store.files().first(), Some(&dirs.global_config_file()));
        assert_eq!(dirs.run_state(), RunState::FirstRun);
        store.set(Scope::Global, "ui.performance", serde_json::json!("quality")).expect("set");
        assert_eq!(dirs.run_state(), RunState::Returning);
    }

    #[test]
    fn the_settings_watcher_creating_the_folder_does_not_end_the_first_run() {
        let env = env();
        let dirs = env.dirs();
        let store = Arc::new(SettingsStore::open(&dirs, None));
        let watcher = SettingsWatcher::start(store, |_| {}).expect("watch");
        assert!(dirs.config().is_dir(), "D-175: the watcher creates the config folder");
        assert_eq!(dirs.run_state(), RunState::FirstRun);
        drop(watcher);
    }
}
