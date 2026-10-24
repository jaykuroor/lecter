//! App identity (`01-architecture.md#app-identity-and-migration`).

/// The bundle identifier, read at build time from `app/tauri.conf.json` (its only source).
/// Nothing the user owns may depend on it: it can change once.
pub const APP_ID: &str = env!("LECTER_APP_ID");

#[cfg(test)]
mod tests {
    use super::APP_ID;

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
}
