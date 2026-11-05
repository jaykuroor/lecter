//! The window's layout across restarts (D-195, `lecter_core::layout`): `app_layout_get` reads it
//! when the UI starts, `app_layout_save` writes it each time the user toggles the sidebar (`␣e`).
//! Both live in `<data>/state.db` beside the course rail (D-188).

use lecter_core::layout::{Layout, LayoutStore};
use tauri::State;

use super::super::error::{ErrorCode, IpcError};

/// The saved layout; the first start's (the sidebar shows) when none was saved.
#[tauri::command]
#[specta::specta]
pub async fn app_layout_get(store: State<'_, LayoutStore>) -> Result<Layout, IpcError> {
    get(&store).await
}

/// Saves `layout`, which the next start opens with. serde refuses anything but
/// `{ sidebar: boolean }`, so there is nothing else to validate (SEC-32).
#[tauri::command]
#[specta::specta]
pub async fn app_layout_save(store: State<'_, LayoutStore>, layout: Layout) -> Result<(), IpcError> {
    save(&store, layout).await
}

/// `app_layout_get` without Tauri's state wrapper.
pub(super) async fn get(store: &LayoutStore) -> Result<Layout, IpcError> {
    let store = store.clone();
    blocking("Lecter could not read the window's layout.", move || store.get())
        .await
        .inspect_err(|e| tracing::warn!(target: "ipc", command = "app_layout_get", code = ?e.code, "layout not read"))
}

/// `app_layout_save` without Tauri's state wrapper.
pub(super) async fn save(store: &LayoutStore, layout: Layout) -> Result<(), IpcError> {
    let store = store.clone();
    blocking("Lecter could not save the window's layout.", move || store.save(layout))
        .await
        .inspect_err(|e| tracing::warn!(target: "ipc", command = "app_layout_save", code = ?e.code, "layout not saved"))
}

/// Runs `work` (it blocks on the disk) off the async runtime; a task that died is `E_INTERNAL`
/// with `failed` as its message.
async fn blocking<T: Send + 'static>(
    failed: &'static str,
    work: impl FnOnce() -> lecter_core::Result<T> + Send + 'static,
) -> Result<T, IpcError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| IpcError::new(ErrorCode::Internal, failed))?
        .map_err(|e| IpcError::new(e.code(), e.to_string()))
}

#[cfg(test)]
mod tests;
