//! The `theme` area (`12-settings-theme-onboarding.md#theme`). On Linux the shell follows the
//! desktop's GTK theme: it reads the desktop's appearance once at start, then a child process
//! (`gdbus monitor` on the settings portal, else `gsettings monitor`) pushes each change and the
//! shell sends `theme:changed` with the tokens to set (D-237: no polling). `theme_get` gives the
//! current tokens, `theme_list` the installed GTK themes; choosing one is `settings_set ui.theme`.
//! The UI applies an update as one batch of CSS custom properties on the root (D-240). The
//! monitor child is stopped, killed and reaped when the app exits ([`Themes::shutdown`]).

use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::Duration;

use lecter_ai::CancellationToken;
use lecter_core::paths::AppDirs;
use lecter_core::settings::SettingsStore;
use lecter_core::theme::gtk::desktop::Change;
use lecter_core::theme::gtk::folders::{InstalledTheme, ThemeDirs};
use lecter_core::theme::gtk::follow::{Follower, ThemeUpdate};
use lecter_core::theme::gtk::monitor::{Ended, Source, Tools};
use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Manager, State};
use tauri_specta::Event;

use super::error::{ErrorCode, IpcError};

/// `theme:changed`: the tokens to set now, after the desktop or `ui.theme` changed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type, Event)]
#[tauri_specta(event_name = "theme:changed")]
pub struct ThemeChanged {
    pub update: ThemeUpdate,
}

/// The theme follower, shared by the commands and the desktop watcher.
#[derive(Debug, Clone)]
pub struct Themes {
    shared: Arc<Mutex<Shared>>,
    tools: Tools,
    monitor: Arc<Monitor>,
}

/// Whether the desktop monitor runs, and the token that stops it at exit.
#[derive(Debug, Default)]
struct Monitor {
    stop: CancellationToken,
    running: Mutex<bool>,
    ended: Condvar,
}

#[derive(Debug)]
struct Shared {
    follower: Follower,
    /// The last update sent or answered, so an unchanged one isn't sent again.
    last: Option<ThemeUpdate>,
}

impl Themes {
    /// Themes from `dirs`, with the desktop read through `tools`.
    pub fn new(dirs: ThemeDirs, tools: Tools) -> Self {
        let shared = Arc::new(Mutex::new(Shared { follower: Follower::new(dirs), last: None }));
        Self { shared, tools, monitor: Arc::default() }
    }

    /// The standard folders and tools; in debug builds a test hook can replace both.
    pub fn standard() -> Self {
        #[cfg(any(debug_assertions, feature = "test-hooks"))]
        if let Some((dirs, tools)) = crate::test_hooks::gtk_desktop() {
            return Self::new(dirs, tools);
        }
        Self::new(ThemeDirs::standard(|k| std::env::var_os(k)), Tools::default())
    }

    fn with<T>(&self, f: impl FnOnce(&mut Shared) -> T) -> T {
        let mut shared = self.shared.lock().unwrap_or_else(PoisonError::into_inner);
        f(&mut shared)
    }

    /// The update for the current state, remembered as the last one. Blocking.
    fn current(&self) -> ThemeUpdate {
        self.with(|s| {
            let update = s.follower.update();
            s.last = Some(update.clone());
            update
        })
    }

    /// The update for the current state when it differs from the last one. Blocking.
    fn changed(&self) -> Option<ThemeUpdate> {
        self.with(|s| {
            let update = s.follower.update();
            (s.last.as_ref() != Some(&update)).then(|| {
                s.last = Some(update.clone());
                update
            })
        })
    }

    /// Follows the desktop's changes from `source` until the monitor exits or [`Self::shutdown`]
    /// stops it; `None` without starting one when shutdown came first.
    async fn watch_desktop(&self, source: Source, on_change: impl FnMut(Change)) -> Option<std::io::Result<Ended>> {
        {
            let mut running = self.monitor.running.lock().unwrap_or_else(PoisonError::into_inner);
            if self.monitor.stop.is_cancelled() {
                return None;
            }
            *running = true;
        }
        let ended =
            lecter_core::theme::gtk::monitor::watch(&self.tools, source, on_change, self.monitor.stop.cancelled())
                .await;
        *self.monitor.running.lock().unwrap_or_else(PoisonError::into_inner) = false;
        self.monitor.ended.notify_all();
        Some(ended)
    }

    /// At exit: stops following the desktop and waits up to `timeout` until the monitor child is
    /// killed and reaped. Whether it is gone (or never ran). Blocking.
    pub fn shutdown(&self, timeout: Duration) -> bool {
        self.monitor.stop.cancel();
        let running = self.monitor.running.lock().unwrap_or_else(PoisonError::into_inner);
        let (running, _) =
            self.monitor.ended.wait_timeout_while(running, timeout, |r| *r).unwrap_or_else(PoisonError::into_inner);
        !*running
    }

    /// The installed GTK themes. Blocking.
    fn list(&self) -> Vec<InstalledTheme> {
        self.with(|s| s.follower.dirs().clone()).list()
    }
}

/// The tokens to set now: the GTK theme in use, light or dark, and its colours. Before the
/// desktop has been read (just after start) it is the chosen theme's or nothing;
/// `theme:changed` follows.
#[tauri::command]
#[specta::specta]
pub async fn theme_get(themes: State<'_, Themes>) -> Result<ThemeUpdate, IpcError> {
    let themes = themes.inner().clone();
    blocking(move || themes.current()).await
}

/// The installed GTK themes (`/usr/share/themes`, `~/.themes`, `~/.local/share/themes`,
/// Flatpak theme extensions), by name; `settings_set ui.theme` applies one.
#[tauri::command]
#[specta::specta]
pub async fn theme_list(themes: State<'_, Themes>) -> Result<Vec<InstalledTheme>, IpcError> {
    let themes = themes.inner().clone();
    blocking(move || themes.list()).await
}

/// Starts following: reads `ui.theme` from the global settings in `dirs`, then (Linux) the
/// desktop, and pushes each change. Runs for the app's life.
pub fn follow(app: &AppHandle, dirs: AppDirs) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let themes = app.state::<Themes>().inner().clone();
        let chosen = themes.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let theme = SettingsStore::open(&dirs, None).settings().ui.theme;
            chosen.with(|s| s.follower.choose(theme));
        })
        .await;
        if cfg!(target_os = "linux") {
            follow_desktop(&app, &themes).await;
        } else {
            announce(&app, &themes).await;
        }
    });
}

async fn follow_desktop(app: &AppHandle, themes: &Themes) {
    use lecter_core::theme::gtk::monitor::read;
    let Some((desktop, source)) = read(&themes.tools).await else {
        tracing::info!(target: "theme", "no desktop settings; the Lecter theme applies");
        announce(app, themes).await;
        return;
    };
    themes.with(|s| s.follower.set_desktop(desktop));
    announce(app, themes).await;
    tracing::info!(target: "theme", source = ?source, "following the desktop's theme");
    let result = themes
        .watch_desktop(source, |change: Change| {
            if themes.with(|s| s.follower.change(change)) {
                let (app, themes) = (app.clone(), themes.clone());
                tauri::async_runtime::spawn(async move { announce(&app, &themes).await });
            }
        })
        .await;
    match result {
        None | Some(Ok(Ended::Stopped)) => {}
        // Not restarted: the theme stays as it is until the next start.
        Some(Ok(Ended::Exited)) => {
            tracing::warn!(target: "theme", source = ?source, "the desktop's settings monitor ended; changes are no longer followed")
        }
        Some(Err(e)) => tracing::warn!(target: "theme", error = %e, "the desktop's settings can't be followed"),
    }
}

/// After `settings_set ui.theme`: applies the new choice.
pub async fn chosen(app: &AppHandle, theme: Option<String>) {
    let Some(themes) = app.try_state::<Themes>().map(|t| t.inner().clone()) else { return };
    if themes.with(|s| s.follower.choose(theme)) {
        announce(app, &themes).await;
    }
}

/// Sends `theme:changed` when the update differs from the last one.
async fn announce(app: &AppHandle, themes: &Themes) {
    let themes = themes.clone();
    let Ok(Some(update)) = tauri::async_runtime::spawn_blocking(move || themes.changed()).await else { return };
    let tokens = update.tokens.len();
    if let Err(e) = (ThemeChanged { update }).emit(app) {
        tracing::warn!(target: "ipc", event = "theme:changed", error = %e, "event not sent");
    } else {
        tracing::debug!(target: "theme", tokens, "theme:changed sent");
    }
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> Result<T, IpcError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| IpcError::new(ErrorCode::Internal, "Lecter could not read the themes."))
}

#[cfg(test)]
mod tests;
