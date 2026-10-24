//! `lecter-app`: the Tauri 2 shell. It opens the main window on the UI and exposes the IPC
//! commands in `ipc/`; everything else lives in the core crates (`01-architecture.md#processes`).

// Release builds on Windows open no console window next to the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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
