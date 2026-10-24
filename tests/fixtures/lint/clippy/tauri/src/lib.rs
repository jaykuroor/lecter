//! Stand-in for Tauri's `tauri::path::PathResolver` at the same path, so the clippy fixture builds
//! in seconds without the real crate. The lint stage checks the configured paths against the real
//! Tauri: clippy warns (an error under `-D warnings`) on a disallowed path that doesn't resolve in
//! `lecter-app`.

/// Same path as Tauri 2's resolver.
pub mod path {
    use std::path::PathBuf;

    /// Same name as Tauri 2's resolver.
    pub struct PathResolver;

    impl PathResolver {
        /// Stand-in for the identifier-keyed config folder.
        pub fn app_config_dir(&self) -> PathBuf {
            PathBuf::from("config")
        }
        /// Stand-in for the identifier-keyed data folder.
        pub fn app_data_dir(&self) -> PathBuf {
            PathBuf::from("data")
        }
        /// Stand-in for the identifier-keyed cache folder.
        pub fn app_cache_dir(&self) -> PathBuf {
            PathBuf::from("cache")
        }
        /// Stand-in for the identifier-keyed local data folder.
        pub fn app_local_data_dir(&self) -> PathBuf {
            PathBuf::from("local")
        }
        /// Stand-in for the identifier-keyed log folder.
        pub fn app_log_dir(&self) -> PathBuf {
            PathBuf::from("log")
        }
    }
}
