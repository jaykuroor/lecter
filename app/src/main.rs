//! `lecter-app`: the Tauri 2 shell. It opens the main window on the UI and exposes the IPC
//! commands in `ipc/`; everything else lives in the core crates (`01-architecture.md#processes`).

// Release builds on Windows open no console window next to the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// `dev` (set by tauri-build when tauri lacks `custom-protocol`) means the window loads
// build.devUrl. A release binary like that would hand the main capability's IPC to whatever
// listens on that port, so it must not build (SEC-30, SEC-31, SEC-34).
#[cfg(all(dev, not(debug_assertions)))]
compile_error!("release builds must embed the UI: build with `--features custom-protocol` (Tauri's CLI adds it)");

mod ipc;

fn main() {
    let result = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ipc::app::app_info])
        .run(tauri::generate_context!());
    if let Err(e) = result {
        eprintln!("Lecter could not start: {e}");
        std::process::exit(1);
    }
}
