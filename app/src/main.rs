//! `lecter-app`: the Tauri 2 shell. It opens the main window on the UI and exposes the IPC
//! commands in `ipc/`; everything else lives in the core crates (`01-architecture.md#processes`).

// Release builds on Windows open no console window next to the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// `dev` (set by tauri-build when tauri lacks `custom-protocol`) means the window loads
// build.devUrl. A release binary like that would hand the main capability's IPC to whatever
// listens on that port, so it must not build (SEC-30, SEC-31, SEC-34).
#[cfg(all(dev, not(debug_assertions)))]
compile_error!("release builds must embed the UI: build with `--features custom-protocol` (Tauri's CLI adds it)");

mod dialog;
// The bindings generator (ipc/export.rs) is the export-bindings binary's; here only its tests run.
#[cfg(test)]
#[path = "ipc/export.rs"]
mod export;
mod ipc;
// Debug builds and the `test-hooks` feature only; release builds never contain it (SEC-34).
#[cfg(any(debug_assertions, feature = "test-hooks"))]
mod test_hooks;

fn main() {
    // The dialog plugin's own commands stay unreachable from the UI: no capability grants them.
    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());
    // The embedded WebDriver server for the real-app e2e (tests/e2e/). It listens on 127.0.0.1
    // only, and the dependency exists only with the `test-hooks` feature (SEC-34).
    #[cfg(feature = "test-hooks")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    // The commands and events of the IPC contract (ipc/mod.rs), behind the argument limits.
    let contract = ipc::contract();
    let result = builder
        .manage(ipc::session::OpenedCourses::default())
        .invoke_handler(ipc::invoke_handler(&contract))
        .setup(move |app| {
            contract.mount_events(app);
            Ok(())
        })
        .run(tauri::generate_context!());
    if let Err(e) = result {
        eprintln!("Lecter could not start: {e}");
        std::process::exit(1);
    }
}
