//! The test-hooks plugin that arms the filter when the main webview navigates to `arm::PATH`
//! (see `arm`). Debug and e2e builds only; F-141 installs the filter itself.

use tauri::plugin::TauriPlugin;
use tauri::{Webview, Wry};

use super::arm;

/// The plugin: watches main-frame navigations for an arm request.
pub fn plugin() -> TauriPlugin<Wry> {
    tauri::plugin::Builder::new("lecter-figure-filter")
        .on_navigation(|webview, url| match arm::parse(url) {
            None => true,
            Some(request) => {
                start(webview.clone(), request);
                false
            }
        })
        .build()
}

/// Arms the filter off the navigation callback (the webview is mid-decision there), then sends the
/// webview on to `next` with the outcome.
fn start(webview: Webview, request: Result<arm::Arm, String>) {
    let request = match request {
        Ok(r) => r,
        Err(e) => {
            // No valid `next` to report to: the page stays, and the flow's wait for the harness fails.
            eprintln!("figure filter: arm request refused: {e}");
            return;
        }
    };
    tauri::async_runtime::spawn(async move {
        let target = webview.clone();
        let next = request.next;
        super::install(
            &webview,
            request.policy,
            Box::new(move |outcome| {
                match &outcome {
                    Ok(kind) => eprintln!("figure filter armed: {kind}"),
                    Err(e) => eprintln!("figure filter failed to arm: {e}"),
                }
                if let Err(e) = target.navigate(arm::report(&next, &outcome)) {
                    eprintln!("figure filter: could not go on to the harness: {e}");
                }
            }),
        );
    });
}
