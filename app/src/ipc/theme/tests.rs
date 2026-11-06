use std::path::PathBuf;

use lecter_core::theme::gtk::desktop::Desktop;
use lecter_core::theme::gtk::tokens::Scheme;

use super::*;

fn fixtures() -> Themes {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/gtk-themes");
    Themes::new(ThemeDirs::new(vec![dir], vec![]), Tools::default())
}

/// The contract (18-contracts.md#ipc, area `theme`): neither command takes anything from the UI.
#[test]
fn the_theme_commands_take_nothing_and_the_event_is_named_by_area() {
    let contract = super::super::contract();
    let args = |name| crate::export::command_args(&contract, name);
    assert_eq!(args("theme_get"), Some(vec![]));
    assert_eq!(args("theme_list"), Some(vec![]));
    assert_eq!(<ThemeChanged as tauri_specta::Event>::NAME, "theme:changed");
}

#[test]
fn an_update_is_sent_only_when_it_differs_from_the_last() {
    let themes = fixtures();
    // Nothing applies yet, and nothing was sent: the empty update is new.
    assert_eq!(themes.changed(), Some(ThemeUpdate::default()));
    assert_eq!(themes.changed(), None);
    themes.with(|s| s.follower.set_desktop(Desktop { theme: Some("Nightish".into()), ..Desktop::default() }));
    let night = themes.changed().unwrap();
    assert_eq!((night.theme.as_deref(), night.scheme), (Some("Nightish"), Some(Scheme::Dark)));
    assert_eq!(themes.changed(), None);
    // What theme_get answers counts as sent.
    themes.with(|s| s.follower.choose(Some("Greyish".into())));
    assert_eq!(themes.current().theme.as_deref(), Some("Greyish"));
    assert_eq!(themes.changed(), None);
}

#[test]
fn the_list_is_the_installed_themes() {
    let names: Vec<String> = fixtures().list().into_iter().map(|t| t.name).collect();
    assert_eq!(names, ["Adwaitish", "Both", "Greyish", "Imported", "Nightish", "Variant"]);
}

/// Themes whose `gdbus` is a fake monitor: it writes its pid to `pid_file`, then waits.
#[cfg(target_os = "linux")]
#[allow(clippy::disallowed_methods, reason = "a test writes its fake tool")]
fn with_sleeping_monitor(dir: &std::path::Path, pid_file: &std::path::Path) -> Themes {
    use std::os::unix::fs::PermissionsExt;
    let gdbus = dir.join("gdbus");
    let file = pid_file.display();
    let script = format!("#!/bin/sh\necho $$ > '{file}.tmp' && mv '{file}.tmp' '{file}'\nexec sleep 600\n");
    std::fs::write(&gdbus, script).unwrap();
    std::fs::set_permissions(&gdbus, std::fs::Permissions::from_mode(0o755)).unwrap();
    let tools = Tools { gdbus: gdbus.into_os_string(), gsettings: "unused".into() };
    Themes::new(ThemeDirs::new(vec![], vec![]), tools)
}

/// The pid in `file` once it is there (deadline 10 s).
#[cfg(target_os = "linux")]
#[allow(clippy::disallowed_methods, reason = "a test polls a file with a deadline")]
fn pid_in(file: &std::path::Path) -> u32 {
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(pid) = std::fs::read_to_string(file).ok().and_then(|t| t.trim().parse().ok()) {
            return pid;
        }
        assert!(std::time::Instant::now() < deadline, "no pid in {}", file.display());
        std::thread::sleep(Duration::from_millis(5));
    }
}

/// The app's exit (`RunEvent::Exit` calls `shutdown`) leaves no monitor behind: it is killed and
/// reaped before `shutdown` returns, and following ends as stopped.
#[cfg(target_os = "linux")]
#[test]
fn shutdown_kills_and_reaps_the_desktop_monitor() {
    let env = lecter_core::testenv::TestEnv::new().unwrap();
    let pid_file = env.home().join("monitor.pid");
    let themes = with_sleeping_monitor(env.home(), &pid_file);
    let watching = themes.clone();
    let task = tauri::async_runtime::spawn(async move { watching.watch_desktop(Source::Portal, |_| {}).await });
    let pid = pid_in(&pid_file);
    assert!(themes.shutdown(Duration::from_secs(5)));
    assert!(!std::path::Path::new(&format!("/proc/{pid}")).exists(), "monitor {pid} outlived shutdown");
    let ended = tauri::async_runtime::block_on(task).unwrap();
    assert_eq!(ended.map(Result::unwrap), Some(Ended::Stopped));
}

/// A shutdown before the desktop is followed starts no monitor at all, and returns at once.
#[cfg(target_os = "linux")]
#[test]
fn after_shutdown_no_monitor_starts() {
    let env = lecter_core::testenv::TestEnv::new().unwrap();
    let pid_file = env.home().join("monitor.pid");
    let themes = with_sleeping_monitor(env.home(), &pid_file);
    assert!(themes.shutdown(Duration::ZERO));
    let ended = tauri::async_runtime::block_on(themes.watch_desktop(Source::Portal, |_| {}));
    assert!(ended.is_none());
    assert!(!pid_file.exists());
}
