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
// The `startup <phase> <ms>` lines (cold_open_ms; 14-quality.md#performance-budgets).
mod startup;
// Debug builds and the `test-hooks` feature only; release builds never contain it (SEC-34).
#[cfg(any(debug_assertions, feature = "test-hooks"))]
mod test_hooks;

fn main() {
    // First, so the start time is read before anything else runs.
    let timing = startup::Startup::from_process_start();
    // The dialog plugin's own commands stay unreachable from the UI: no capability grants them.
    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());
    // The embedded WebDriver server for the real-app e2e (tests/e2e/). It listens on 127.0.0.1
    // only, and the dependency exists only with the `test-hooks` feature (SEC-34).
    #[cfg(feature = "test-hooks")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    // The commands and events of the IPC contract (ipc/mod.rs), behind the argument limits.
    let contract = ipc::contract();
    // The open lectures' save sessions; quitting saves them (F-021).
    let lectures = ipc::session::OpenLectures::default();
    // The running gloss streams; quitting stops them (F-023).
    let glosses = ipc::ai::Glosses::default();
    let built = builder
        .manage(ipc::session::OpenedCourses::default())
        .manage(lectures.clone())
        .manage(ipc::search::SearchIndexes::default())
        .manage(glosses.clone())
        .manage(timing.clone())
        .invoke_handler(ipc::invoke_handler(&contract))
        .on_page_load({
            let timing = timing.clone();
            move |webview, payload| {
                if webview.label() == "main" && payload.event() == tauri::webview::PageLoadEvent::Started {
                    timing.mark_now(startup::Phase::PageLoadStarted);
                }
            }
        })
        .setup(move |app| {
            // Tauri builds the windows of tauri.conf.json before this hook runs.
            timing.mark_now(startup::Phase::WindowCreated);
            contract.mount_events(app);
            Ok(())
        })
        .build(tauri::generate_context!());
    match built {
        Ok(app) => app.run(move |_, event| {
            if let tauri::RunEvent::Exit = event {
                glosses.cancel_all();
                ipc::lecture::close_all(&lectures);
            }
        }),
        Err(e) => {
            eprintln!("Lecter could not start: {e}");
            std::process::exit(1);
        }
    }
}
