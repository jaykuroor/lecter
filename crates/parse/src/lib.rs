//! `lecter-parse`: Parse worker: reads one untrusted slide file into blocks, layout and crops.

/// This crate's package name.
pub const NAME: &str = env!("CARGO_PKG_NAME");

/// This crate's version, inherited from the workspace.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    #[test]
    fn crate_is_named_after_its_folder_and_carries_a_semver_version() {
        assert_eq!(super::NAME, "lecter-parse");
        let parts: Vec<&str> = super::VERSION.split('.').collect();
        assert_eq!(parts.len(), 3, "{}", super::VERSION);
        assert!(parts.iter().all(|p| p.parse::<u32>().is_ok()), "{}", super::VERSION);
    }
}
