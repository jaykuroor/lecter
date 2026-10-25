//! Native dialogs. Every one goes through here, so the debug-only `test_hooks` can answer it
//! (WebDriver can't see a native dialog) and release builds open the real one.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, FilePath};

/// Asks the user for a folder. `None` when they cancel. Never blocks the async runtime: the
/// dialog runs on the main thread and answers through a channel.
pub async fn pick_folder(app: &AppHandle) -> Option<PathBuf> {
    #[cfg(any(debug_assertions, feature = "test-hooks"))]
    if let Some(path) = crate::test_hooks::picked_path() {
        return Some(path);
    }
    // One answer per dialog, so a bound of 1 never makes the callback wait.
    let (tx, mut rx) = tauri::async_runtime::channel::<Option<FilePath>>(1);
    let mut dialog = app.dialog().file();
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    dialog.pick_folder(move |folder| {
        // Fails only when the command was dropped, and then nobody waits for the answer.
        tx.try_send(folder).ok();
    });
    rx.recv().await.flatten().and_then(|f| f.into_path().ok())
}
