//! The `app` area: what the shell shows about the running app.

use serde::Serialize;
use tauri::PackageInfo;

/// `app_info`'s result; the UI's `AppInfo` (`ui/src/core/commands.ts`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
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
pub fn app_info(app: tauri::AppHandle) -> AppInfo {
    AppInfo::from_package(app.package_info())
}

#[cfg(test)]
mod tests {
    use super::*;

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
