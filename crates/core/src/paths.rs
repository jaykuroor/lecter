//! The app's config, data and cache folders (`01-architecture.md#app-identity-and-migration`), and
//! the debug-only test-home override ([`TEST_HOME_VAR`]) (`01-architecture.md#debug-only-test-hooks`).
//!
//! Every path Lecter keeps outside a course folder derives from one [`AppDirs`], so pointing
//! the test home at a temp dir moves all of them there and tests never touch real folders.
//! Resolving creates nothing on disk.

use std::path::{Path, PathBuf};

use crate::identity::APP_DIR_NAME;

/// The environment variable that moves every config, data and cache folder under one directory.
/// Debug builds and the `test-hooks` feature only; release builds don't contain it.
#[cfg(any(debug_assertions, feature = "test-hooks"))]
pub const TEST_HOME_VAR: &str = "LECTER_TEST_HOME";

/// Why the folders can't be resolved.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PathsError {
    /// The OS reports no home directory, so there is nowhere to put the folders.
    #[error("no home directory: the config, data and cache folders have nowhere to go")]
    NoHome,
    /// The test home is empty or relative; resolving it against the working directory could land
    /// anywhere, so it is refused.
    #[cfg(any(debug_assertions, feature = "test-hooks"))]
    #[error("the test home must be an absolute path")]
    TestHomeNotAbsolute,
}

/// An operating system row of the folder table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    /// Linux and other XDG systems.
    Linux,
    /// macOS.
    MacOs,
    /// Windows.
    Windows,
}

impl Os {
    /// The row for the OS this binary was built for.
    pub const fn host() -> Self {
        if cfg!(windows) {
            Self::Windows
        } else if cfg!(target_os = "macos") {
            Self::MacOs
        } else {
            Self::Linux
        }
    }
}

/// The OS base folders the app folders are placed in, before [`APP_DIR_NAME`] is added.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BaseDirs {
    /// The user's home directory.
    pub home: PathBuf,
    /// `$XDG_CONFIG_HOME` when set to an absolute path (Linux and macOS honour it).
    pub xdg_config_home: Option<PathBuf>,
    /// The OS config folder: `$XDG_CONFIG_HOME` or `~/.config` on Linux, `%APPDATA%` on Windows.
    pub config: PathBuf,
    /// The OS data folder: `~/.local/share` on Linux, `~/Library/Application Support` on macOS.
    pub data: PathBuf,
    /// The OS local (non-roaming) data folder: `%LOCALAPPDATA%` on Windows.
    pub data_local: PathBuf,
    /// The OS cache folder: `~/.cache` on Linux, `~/Library/Caches` on macOS.
    pub cache: PathBuf,
}

impl BaseDirs {
    /// The real base folders of this user, from the `directories` crate.
    pub fn from_system() -> Option<Self> {
        let d = directories::BaseDirs::new()?;
        let xdg = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).filter(|p| p.is_absolute());
        Some(Self {
            home: d.home_dir().to_path_buf(),
            xdg_config_home: xdg,
            config: d.config_dir().to_path_buf(),
            data: d.data_dir().to_path_buf(),
            data_local: d.data_local_dir().to_path_buf(),
            cache: d.cache_dir().to_path_buf(),
        })
    }
}

/// The three folders Lecter keeps outside course folders.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppDirs {
    config: PathBuf,
    data: PathBuf,
    cache: PathBuf,
}

impl AppDirs {
    /// This user's folders, or the test home's when [`TEST_HOME_VAR`] is set (debug builds).
    pub fn resolve() -> Result<Self, PathsError> {
        #[cfg(any(debug_assertions, feature = "test-hooks"))]
        let test_home = std::env::var_os(TEST_HOME_VAR);
        #[cfg(not(any(debug_assertions, feature = "test-hooks")))]
        let test_home: Option<std::ffi::OsString> = None;
        Self::resolve_from(test_home, Os::host(), BaseDirs::from_system)
    }

    /// [`Self::resolve`] with its inputs passed in. `system` is called only without a test home,
    /// so a test home never even looks at the real folders.
    fn resolve_from(
        test_home: Option<std::ffi::OsString>,
        os: Os,
        system: impl FnOnce() -> Option<BaseDirs>,
    ) -> Result<Self, PathsError> {
        #[cfg(any(debug_assertions, feature = "test-hooks"))]
        if let Some(home) = test_home {
            return Self::under_test_home(Path::new(&home));
        }
        #[cfg(not(any(debug_assertions, feature = "test-hooks")))]
        let _ = test_home;
        system().map(|base| Self::for_os(os, &base)).ok_or(PathsError::NoHome)
    }

    /// The folders of the table in `01-architecture.md#app-identity-and-migration` for `os`.
    pub fn for_os(os: Os, base: &BaseDirs) -> Self {
        let app = |p: &Path| p.join(APP_DIR_NAME);
        match os {
            Os::Linux => Self { config: app(&base.config), data: app(&base.data), cache: app(&base.cache) },
            Os::MacOs => {
                let config = base.xdg_config_home.clone().unwrap_or_else(|| base.home.join(".config"));
                Self { config: app(&config), data: app(&base.data), cache: app(&base.cache) }
            }
            Os::Windows => {
                let local = app(&base.data_local);
                Self { config: app(&base.config), data: local.join("data"), cache: local.join("cache") }
            }
        }
    }

    /// `<home>/config`, `<home>/data` and `<home>/cache`.
    #[cfg(any(debug_assertions, feature = "test-hooks"))]
    pub fn under_test_home(home: &Path) -> Result<Self, PathsError> {
        if !home.is_absolute() {
            return Err(PathsError::TestHomeNotAbsolute);
        }
        Ok(Self::at(home))
    }

    /// The test-home layout under `home`, unchecked (`TestEnv` homes are absolute by construction).
    #[cfg(any(debug_assertions, feature = "test-hooks"))]
    pub(crate) fn at(home: &Path) -> Self {
        Self { config: home.join("config"), data: home.join("data"), cache: home.join("cache") }
    }

    /// The config folder (global settings, themes, roles).
    pub fn config(&self) -> &Path {
        &self.config
    }

    /// The data folder (app state that isn't a cache).
    pub fn data(&self) -> &Path {
        &self.data
    }

    /// The cache folder (anything that can be rebuilt).
    pub fn cache(&self) -> &Path {
        &self.cache
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base(root: &str) -> BaseDirs {
        let r = PathBuf::from(root);
        BaseDirs {
            home: r.join("home"),
            xdg_config_home: None,
            config: r.join("cfg"),
            data: r.join("data"),
            data_local: r.join("local"),
            cache: r.join("cache"),
        }
    }

    fn all(d: &AppDirs) -> [&Path; 3] {
        [d.config(), d.data(), d.cache()]
    }

    /// An absolute path on the host, so the tests run the same on every OS.
    #[cfg(any(debug_assertions, feature = "test-hooks"))]
    fn abs(rel: &str) -> PathBuf {
        std::env::temp_dir().join(rel)
    }

    #[test]
    #[cfg(any(debug_assertions, feature = "test-hooks"))]
    fn test_home_puts_config_data_and_cache_under_it() {
        let home = abs("lecter-test-home");
        let d = AppDirs::resolve_from(Some(home.clone().into()), Os::host(), || Some(base("/real"))).expect("resolves");
        for p in all(&d) {
            assert!(p.starts_with(&home), "{} is not under {}", p.display(), home.display());
            assert_ne!(p, home, "each folder is its own subfolder");
        }
        assert_eq!(d.config(), home.join("config"));
        assert_eq!(d.data(), home.join("data"));
        assert_eq!(d.cache(), home.join("cache"));
    }

    #[test]
    #[cfg(any(debug_assertions, feature = "test-hooks"))]
    fn test_home_never_consults_the_real_folders() {
        for os in [Os::Linux, Os::MacOs, Os::Windows] {
            let home: std::ffi::OsString = abs("lecter-no-real").into();
            let d = AppDirs::resolve_from(Some(home), os, || panic!("real folders consulted on {os:?}"));
            assert!(d.is_ok(), "{d:?}");
        }
    }

    #[test]
    #[cfg(any(debug_assertions, feature = "test-hooks"))]
    fn test_home_holds_for_unusual_directory_names() {
        for name in ["with space", "ünïcödé", "dots.in.name", "a/b/c", "x/../y", "-dash"] {
            let home = abs(name);
            let d = AppDirs::resolve_from(Some(home.clone().into()), Os::host(), || None).expect("resolves");
            for p in all(&d) {
                assert!(p.starts_with(&home), "{name}: {} not under {}", p.display(), home.display());
            }
        }
    }

    #[test]
    #[cfg(any(debug_assertions, feature = "test-hooks"))]
    fn relative_or_empty_test_home_is_refused() {
        for bad in ["", "relative/dir", "."] {
            let r = AppDirs::resolve_from(Some(bad.into()), Os::host(), || Some(base("/real")));
            assert_eq!(r, Err(PathsError::TestHomeNotAbsolute), "{bad:?}");
        }
    }

    #[test]
    fn without_test_home_the_os_table_applies() {
        let d = AppDirs::resolve_from(None, Os::Linux, || Some(base("/r"))).expect("resolves");
        assert_eq!(all(&d), [Path::new("/r/cfg/lecter"), Path::new("/r/data/lecter"), Path::new("/r/cache/lecter")]);
    }

    #[test]
    fn no_home_directory_is_an_error() {
        assert_eq!(AppDirs::resolve_from(None, Os::host(), || None), Err(PathsError::NoHome));
    }

    #[test]
    fn macos_config_is_dot_config_unless_xdg_config_home_is_set() {
        let mut b = base("/r");
        let d = AppDirs::for_os(Os::MacOs, &b);
        assert_eq!(
            all(&d),
            [Path::new("/r/home/.config/lecter"), Path::new("/r/data/lecter"), Path::new("/r/cache/lecter")]
        );
        b.xdg_config_home = Some(PathBuf::from("/x"));
        assert_eq!(AppDirs::for_os(Os::MacOs, &b).config(), Path::new("/x/lecter"));
    }

    #[test]
    fn windows_keeps_config_roaming_and_data_and_cache_local() {
        let d = AppDirs::for_os(Os::Windows, &base("/r"));
        let want = [Path::new("/r/cfg/lecter"), Path::new("/r/local/lecter/data"), Path::new("/r/local/lecter/cache")];
        assert_eq!(all(&d), want);
    }

    #[test]
    fn every_folder_is_named_after_app_dir_name_not_the_bundle_identifier() {
        for os in [Os::Linux, Os::MacOs, Os::Windows] {
            let d = AppDirs::for_os(os, &base("/r"));
            for p in all(&d) {
                assert!(p.iter().any(|c| c == APP_DIR_NAME), "{os:?}: {}", p.display());
                assert!(!p.to_string_lossy().contains(crate::identity::APP_ID), "{os:?}: {}", p.display());
            }
        }
    }

    #[test]
    fn the_real_folders_end_in_the_app_folder() {
        // Reads only this user's base folders; creates nothing.
        if let Some(b) = BaseDirs::from_system() {
            let d = AppDirs::for_os(Os::host(), &b);
            assert!(all(&d).iter().all(|p| p.is_absolute() && p.iter().any(|c| c == APP_DIR_NAME)), "{d:?}");
        }
    }
}
