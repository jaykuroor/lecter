//! [`TestEnv`]: a throwaway `LECTER_TEST_HOME` for tests (`tests/CLAUDE.md`), so no test touches
//! the real config, data or cache folders. Debug builds and the `test-hooks` feature only.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};

use crate::paths::{AppDirs, TEST_HOME_VAR};

/// Distinguishes the homes made by one test process.
static NEXT: AtomicU32 = AtomicU32::new(0);

/// A fresh, empty directory under the system temp dir that stands in for every app folder.
/// Removed, with everything in it, on drop.
#[derive(Debug)]
pub struct TestEnv {
    home: PathBuf,
}

impl TestEnv {
    /// Creates a new home no other `TestEnv` (in this or another process) shares.
    #[allow(clippy::disallowed_methods, reason = "a test helper; it runs on test threads, never on the runtime")]
    pub fn new() -> std::io::Result<Self> {
        let mut tmp = std::env::temp_dir();
        if !tmp.is_absolute() {
            tmp = std::env::current_dir()?.join(tmp);
        }
        std::fs::create_dir_all(&tmp)?;
        loop {
            let n = NEXT.fetch_add(1, Ordering::Relaxed);
            let home = tmp.join(format!("lecter-test-home-{}-{n}", std::process::id()));
            // create_dir (not _all) fails on an existing dir, e.g. one left by a killed run that had this pid.
            match std::fs::create_dir(&home) {
                Ok(()) => return Ok(Self { home }),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e),
            }
        }
    }

    /// The directory `LECTER_TEST_HOME` points at.
    pub fn home(&self) -> &Path {
        &self.home
    }

    /// The folders the core resolves under this home.
    pub fn dirs(&self) -> AppDirs {
        // `new` made `home` absolute, the one thing `under_test_home` checks.
        AppDirs::at(&self.home)
    }

    /// Points a child process at this home.
    pub fn apply<'c>(&self, cmd: &'c mut Command) -> &'c mut Command {
        cmd.env(TEST_HOME_VAR, &self.home)
    }
}

impl Drop for TestEnv {
    #[allow(clippy::disallowed_methods, reason = "a test helper; it runs on test threads, never on the runtime")]
    fn drop(&mut self) {
        // Best effort: a leftover temp dir is harmless and must not turn a passing test into a panic.
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

#[cfg(test)]
#[allow(clippy::disallowed_methods, reason = "tests write into their own temp dirs on plain test threads")]
mod tests {
    use super::*;

    #[test]
    fn each_env_gets_its_own_empty_absolute_home_under_temp() {
        let a = TestEnv::new().unwrap();
        let b = TestEnv::new().unwrap();
        assert_ne!(a.home(), b.home());
        for env in [&a, &b] {
            assert!(env.home().is_absolute() && env.home().is_dir(), "{}", env.home().display());
            assert_eq!(std::fs::read_dir(env.home()).unwrap().count(), 0, "starts empty");
        }
    }

    #[test]
    fn dropping_the_env_removes_its_home_and_contents() {
        let env = TestEnv::new().unwrap();
        let home = env.home().to_path_buf();
        std::fs::create_dir_all(env.dirs().config()).unwrap();
        std::fs::write(env.dirs().config().join("settings.jsonc"), "{}").unwrap();
        drop(env);
        assert!(!home.exists(), "{} still exists", home.display());
    }

    #[test]
    fn dirs_are_the_core_folders_under_the_home() {
        let env = TestEnv::new().unwrap();
        let d = env.dirs();
        assert_eq!(AppDirs::under_test_home(env.home()).unwrap(), d);
        assert!([d.config(), d.data(), d.cache()].iter().all(|p| p.starts_with(env.home())));
    }

    #[test]
    fn apply_sets_lecter_test_home_on_the_child() {
        let env = TestEnv::new().unwrap();
        let mut cmd = Command::new("child");
        env.apply(&mut cmd);
        let set: Vec<_> = cmd.get_envs().filter(|(k, _)| *k == TEST_HOME_VAR).collect();
        assert_eq!(set, [(std::ffi::OsStr::new("LECTER_TEST_HOME"), Some(env.home().as_os_str()))]);
    }
}
