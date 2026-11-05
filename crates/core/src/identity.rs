//! App identity (`01-architecture.md#app-identity-and-migration`), and the migration hook that
//! moves what an earlier identifier left behind ([`migrate()`]).

mod keychain;
mod legacy_dirs;
mod migrate;
mod record;
#[cfg(test)]
mod tests_keychain;
#[cfg(test)]
mod tests_migrate;

pub use keychain::{Keychain, KeychainError};
pub use migrate::{LeftReason, Leftover, MigrateError, Migration, Outcome, Report, migrate};
pub(crate) use record::open as open_state_db;
pub use record::{MIGRATED_KEY, STATE_DB};

/// The bundle identifier, read at build time from `app/tauri.conf.json` (its only source).
/// Nothing the user owns may depend on it: it can change once.
pub const APP_ID: &str = env!("LECTER_APP_ID");

/// The folder name every config, data and cache path derives from (`crate::paths`), never the
/// bundle identifier, so a rename of [`APP_ID`] moves nothing the user owns.
pub const APP_DIR_NAME: &str = "lecter";

/// The OS keychain service every saved secret is filed under, never the bundle identifier, so a
/// rename of [`APP_ID`] loses no key.
pub const KEYCHAIN_SERVICE: &str = "lecter";

/// Earlier bundle identifiers, oldest first. [`migrate()`] moves what each left behind to the
/// stable folders and keychain service. Renaming [`APP_ID`] means adding the old one here.
pub const LEGACY_APP_IDS: &[&str] = &[];

/// The names one build of the app goes by. Every location derives from an `Identity`
/// ([`crate::paths::AppDirs::derive`]), so a test can change the identifier and check that
/// nothing the user owns moves.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Identity {
    /// The bundle identifier.
    pub app_id: &'static str,
    /// The folder name inside the OS config, data and cache folders.
    pub dir_name: &'static str,
    /// The keychain service secrets are saved under.
    pub keychain_service: &'static str,
}

/// This build's identity.
pub const CURRENT: Identity = Identity { app_id: APP_ID, dir_name: APP_DIR_NAME, keychain_service: KEYCHAIN_SERVICE };

#[cfg(test)]
#[allow(clippy::disallowed_methods, reason = "tests read repo files on plain test threads")]
mod tests {
    use super::{APP_DIR_NAME, APP_ID, CURRENT, KEYCHAIN_SERVICE, LEGACY_APP_IDS};

    #[test]
    fn app_id_is_the_identifier_in_tauri_conf() {
        let conf = concat!(env!("CARGO_MANIFEST_DIR"), "/../../app/tauri.conf.json");
        let text = std::fs::read_to_string(conf).unwrap_or_else(|e| panic!("{conf}: {e}"));
        assert!(
            text.contains(&format!("\"identifier\": \"{APP_ID}\"")),
            "{APP_ID} is not tauri.conf.json's identifier"
        );
        assert!(APP_ID.split('.').count() >= 3, "{APP_ID} is not reverse-DNS");
    }

    #[test]
    fn folder_and_keychain_names_are_lecter_not_the_identifier() {
        assert_eq!(APP_DIR_NAME, "lecter");
        assert_eq!(KEYCHAIN_SERVICE, "lecter");
        assert_eq!((CURRENT.app_id, CURRENT.dir_name, CURRENT.keychain_service), (APP_ID, "lecter", "lecter"));
        assert_ne!(CURRENT.app_id, CURRENT.dir_name, "the identifier is not the stable name");
    }

    #[test]
    fn no_legacy_identifier_in_v0() {
        assert_eq!(LEGACY_APP_IDS, &[] as &[&str], "v0 has never been renamed");
    }
}
