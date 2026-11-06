//! Following the OS light/dark mode and accent colour on macOS and Windows
//! (12-settings-theme-onboarding.md#theme). The mode comes from the window (tao reads the OS
//! appearance and reports each change); the accent from `defaults` or `reg`
//! ([`lecter_core::theme::accent`]), read at start and again whenever the window gains focus or
//! the OS mode changes, the moments a changed accent can have been chosen in System Settings.
//! Nothing polls (D-237).

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use lecter_core::theme::accent::{self, Os};
use lecter_core::theme::gtk::desktop::Change;
use lecter_core::theme::gtk::tokens::Scheme;
use tauri::{AppHandle, Manager, WindowEvent};

use super::{Themes, announce, diag};

/// The window whose appearance and focus are followed.
const WINDOW: &str = "main";

/// The scheme a window theme stands for.
pub(super) fn scheme(theme: tauri::Theme) -> Option<Scheme> {
    match theme {
        tauri::Theme::Light => Some(Scheme::Light),
        tauri::Theme::Dark => Some(Scheme::Dark),
        _ => None,
    }
}

/// What a window event asks for: `Some(scheme change)` to re-read (with the new mode when the
/// mode changed); `None` for events that change nothing.
pub(super) fn wanted(event: &WindowEvent) -> Option<Option<Change>> {
    match event {
        WindowEvent::Focused(true) => Some(None),
        WindowEvent::ThemeChanged(theme) => Some(Some(Change::Scheme(scheme(*theme)))),
        _ => None,
    }
}

/// Reads the OS mode and accent, sends the update, then re-reads on the window's events.
pub(super) async fn follow(app: &AppHandle, themes: &Themes) {
    let Some(os) = Os::current() else {
        super::announce(app, themes).await;
        return;
    };
    let window = app.get_webview_window(WINDOW);
    if let Some(theme) = window.as_ref().and_then(|w| w.theme().ok()) {
        themes.with(|s| s.follower.change(Change::Scheme(scheme(theme))));
    }
    refresh(app, themes, os).await;
    let Some(window) = window else { return };
    let busy = Arc::new(AtomicBool::new(false));
    let (app, themes) = (app.clone(), themes.clone());
    window.on_window_event(move |event| {
        let Some(change) = wanted(event) else { return };
        if let Some(change) = change {
            themes.with(|s| s.follower.change(change));
        }
        // One read at a time: a focus burst while `defaults` or `reg` runs needs no second one.
        if busy.swap(true, Ordering::AcqRel) {
            return;
        }
        let (app, themes, busy) = (app.clone(), themes.clone(), Arc::clone(&busy));
        tauri::async_runtime::spawn(async move {
            refresh(&app, &themes, os).await;
            busy.store(false, Ordering::Release);
        });
    });
}

/// Re-reads the accent and sends the update when anything changed.
async fn refresh(app: &AppHandle, themes: &Themes, os: Os) {
    let found = accent::read(os, &themes.accent_tools).await;
    diag(format_args!("{os:?} accent {:?}", found.map(|c| c.to_string())));
    themes.with(|s| s.follower.change(Change::Accent(found)));
    announce(app, themes).await;
}
