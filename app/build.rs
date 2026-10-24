//! Tauri's build step: embeds the config and generates one `allow-<command>` permission per
//! command in `src/ipc/names.rs`, so capabilities can grant commands one at a time (SEC-31).

include!("src/ipc/names.rs");

fn main() {
    let attributes = tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    if let Err(e) = tauri_build::try_build(attributes) {
        panic!("tauri build step failed: {e:#}");
    }
}
