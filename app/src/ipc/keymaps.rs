//! The `keymaps` area: the user's `keymaps.jsonc` (D-199, `lecter_core::keymaps`). The UI asks for
//! it once, after its key engine is in, and lays it over the default keymap; until it arrives,
//! and when it can't be used, the defaults apply.

use lecter_core::keymaps::KeymapsFile;
use tauri::State;

use super::error::{ErrorCode, IpcError};

/// The text of `keymaps.jsonc` in the global config folder, or `null` when there is none. Takes no
/// arguments, so there is nothing to validate (SEC-32); the file is capped at 256 KB and never logged.
#[tauri::command]
#[specta::specta]
pub async fn keymaps_read(file: State<'_, KeymapsFile>) -> Result<Option<String>, IpcError> {
    read(&file).await
}

/// `keymaps_read` without Tauri's state wrapper.
pub(super) async fn read(file: &KeymapsFile) -> Result<Option<String>, IpcError> {
    let file = file.clone();
    tauri::async_runtime::spawn_blocking(move || file.read())
        .await
        .map_err(|_| IpcError::new(ErrorCode::Internal, "Lecter could not read keymaps.jsonc."))?
        .map_err(|e| IpcError::new(e.code(), e.to_string()))
        .inspect_err(|e| tracing::warn!(target: "ipc", command = "keymaps_read", code = ?e.code, "keymaps not read"))
}

#[cfg(test)]
mod tests;
