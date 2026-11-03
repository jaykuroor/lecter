//! The `app` area: what the shell shows about the running app, and the UI's startup paints.

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{PackageInfo, State};

use crate::startup::{Phase, Startup};

/// `app_info`'s result; the UI's `AppInfo` (`ui/src/core/bindings.ts`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

impl AppInfo {
    fn from_package(p: &PackageInfo) -> Self {
        Self { name: p.name.clone(), version: p.version.to_string() }
    }
}

/// The product name and version from `tauri.conf.json`. Takes no arguments, so there is nothing
/// to validate (SEC-32).
#[tauri::command]
#[specta::specta]
pub fn app_info(app: tauri::AppHandle) -> AppInfo {
    AppInfo::from_package(app.package_info())
}

/// A startup paint the UI reports to `app_mark_startup`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum StartupPaint {
    /// The app's frame is on screen.
    ShellFirstPaint,
    /// The first lecture opened this session is on screen in the buffer.
    BufferFirstPaint,
}

impl From<StartupPaint> for Phase {
    fn from(p: StartupPaint) -> Self {
        match p {
            StartupPaint::ShellFirstPaint => Phase::ShellFirstPaint,
            StartupPaint::BufferFirstPaint => Phase::BufferFirstPaint,
        }
    }
}

/// The UI has just painted `paint`: the shell logs its `startup <phase> <ms>` line, timed when
/// the call arrives (the UI calls right after the paint), the first time only
/// (`14-quality.md#performance-budgets`). The UI never chooses the time, and serde refuses any
/// other phase name, so there is nothing else to validate (SEC-32).
#[tauri::command]
#[specta::specta]
pub fn app_mark_startup(startup: State<'_, Startup>, paint: StartupPaint) {
    startup.mark_now(paint.into());
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};
    use std::time::SystemTime;

    use super::*;

    #[test]
    fn the_ui_names_its_paints_in_snake_case() {
        let parse = |s: &str| serde_json::from_value::<StartupPaint>(serde_json::json!(s)).ok();
        assert_eq!(parse("shell_first_paint"), Some(StartupPaint::ShellFirstPaint));
        assert_eq!(parse("buffer_first_paint"), Some(StartupPaint::BufferFirstPaint));
        // The shell's own phases can't be claimed by the UI.
        assert_eq!(parse("window_created"), None);
        assert_eq!(parse("page_load_started"), None);
        assert_eq!(parse("ShellFirstPaint"), None);
    }

    #[test]
    fn each_paint_logs_its_own_phase() {
        let lines = Arc::new(Mutex::new(Vec::<String>::new()));
        let sink = Arc::clone(&lines);
        let startup = Startup::new(SystemTime::now(), move |l| sink.lock().unwrap().push(l.to_owned()));
        startup.mark_now(StartupPaint::BufferFirstPaint.into());
        startup.mark_now(StartupPaint::ShellFirstPaint.into());
        let names: Vec<String> =
            lines.lock().unwrap().iter().map(|l| l.rsplit_once(' ').unwrap().0.to_owned()).collect();
        assert_eq!(names, ["startup buffer-first-paint", "startup shell-first-paint"]);
    }

    #[test]
    fn app_info_reports_the_product_name_and_version() {
        let p = PackageInfo {
            name: "Lecter".into(),
            version: "0.0.1".parse().unwrap_or_else(|e| panic!("{e}")),
            authors: "",
            description: "",
            crate_name: "lecter-app",
        };
        assert_eq!(AppInfo::from_package(&p), AppInfo { name: "Lecter".into(), version: "0.0.1".into() });
    }

    #[test]
    fn app_info_serialises_to_the_ui_shape() {
        let info = AppInfo { name: "Lecter".into(), version: "0.0.1".into() };
        let json = serde_json::to_value(&info).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(json, serde_json::json!({ "name": "Lecter", "version": "0.0.1" }));
    }
}
