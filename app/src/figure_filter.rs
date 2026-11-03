//! The figure frames' native request filter (08-figures.md#sandbox-pages, D-145): below the page,
//! every request from a figure frame that isn't to a figure origin (`lecter-fig:`, `lecter-lib:`)
//! is refused, because the frame's CSP alone doesn't hold (WebView2 sends `<link rel=prefetch>`
//! despite `default-src 'none'`, D-142).
//!
//! - WebKitGTK and WKWebView: a content rule list that blocks every load in a child frame except to
//!   the figure origins (`policy::Policy::webkit_rules`).
//! - WebView2: a `WebResourceRequested` handler on every URL and every source kind. It can't tell a
//!   frame's request from the page's, so the page's own origins pass too.
//!
//! Until F-141 serves `lecter-fig:` and installs it for real, this compiles only with `test-hooks`:
//! the F-028 spike arms it from its e2e flow (`arm`, `plugin`). The policy is plain code and is
//! unit-tested in every build.

pub mod arm;
pub mod policy;

#[cfg(feature = "test-hooks")]
mod plugin;
#[cfg(all(feature = "test-hooks", target_os = "windows"))]
mod webview2;
#[cfg(all(feature = "test-hooks", target_os = "linux"))]
mod webkitgtk;
#[cfg(all(feature = "test-hooks", target_os = "macos"))]
mod wkwebview;

#[cfg(feature = "test-hooks")]
pub use plugin::plugin;

/// Called once the filter is in place (with what kind) or couldn't be (with why).
#[cfg(feature = "test-hooks")]
pub type Done = Box<dyn FnOnce(Result<&'static str, String>) + Send + 'static>;

/// Installs the filter on `webview` (on the main thread, where the webview lives) and calls `done`
/// once it holds or couldn't be installed.
#[cfg(feature = "test-hooks")]
fn install(webview: &tauri::Webview, policy: policy::Policy, done: Done) {
    use std::sync::{Arc, Mutex, PoisonError};
    let slot = Arc::new(Mutex::new(Some(done)));
    let take = |slot: &Mutex<Option<Done>>| slot.lock().unwrap_or_else(PoisonError::into_inner).take();
    let inner = Arc::clone(&slot);
    let queued = webview.with_webview(move |platform| {
        if let Some(done) = take(&inner) {
            #[cfg(target_os = "windows")]
            webview2::install(&platform, &policy, done);
            #[cfg(target_os = "linux")]
            webkitgtk::install(&platform, &policy, done);
            #[cfg(target_os = "macos")]
            wkwebview::install(&platform, &policy, done);
            #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
            {
                let _ = (&platform, &policy);
                done(Err("no request filter on this OS".to_owned()));
            }
        }
    });
    if let Err(e) = queued
        && let Some(done) = take(&slot)
    {
        done(Err(format!("the webview is gone: {e}")));
    }
}
