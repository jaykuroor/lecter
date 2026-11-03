//! WebView2: a `WebResourceRequested` handler on every URL, every resource context and (runtime
//! 1.0.2420+, `ICoreWebView2_22`) every request source, including frames. A request the policy
//! refuses gets a 403 made here, so it never reaches the network. WebView2 doesn't say which frame
//! a request comes from, so the page's own origins pass too (`Source::Any`). Runs on the UI thread.

use tauri::webview::PlatformWebview;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL, ICoreWebView2,
    ICoreWebView2_2, ICoreWebView2_22, ICoreWebView2Environment,
};
use webview2_com::{WebResourceRequestedEventHandler, take_pwstr};
use windows_core::{Interface, PWSTR, w};

use super::Done;
use super::policy::{Policy, Source};

pub fn install(platform: &PlatformWebview, policy: &Policy, done: Done) {
    let installed = attach(platform, policy.clone());
    done(installed.map_err(|e| format!("WebResourceRequested: {e}")));
}

/// Adds the catch-all filter and the handler that refuses what `policy` doesn't allow.
fn attach(platform: &PlatformWebview, policy: Policy) -> windows_core::Result<&'static str> {
    // SAFETY (every block here): COM calls on this webview's own interfaces, on its UI thread
    // (with_webview runs us there, and WebView2 raises the event there).
    let webview: ICoreWebView2 = unsafe { platform.controller().CoreWebView2()? };
    let kind = match webview.cast::<ICoreWebView2_22>() {
        Ok(v22) => {
            unsafe {
                v22.AddWebResourceRequestedFilterWithRequestSourceKinds(
                    w!("*"),
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                    COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
                )?
            };
            "web-resource-requested (all source kinds)"
        }
        Err(_) => {
            unsafe { webview.AddWebResourceRequestedFilter(w!("*"), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)? };
            "web-resource-requested (documents only)"
        }
    };
    let env: ICoreWebView2Environment = unsafe { webview.cast::<ICoreWebView2_2>()?.Environment()? };
    let handler = WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
        let Some(args) = args else {
            return Ok(());
        };
        let mut uri = PWSTR::null();
        // take_pwstr frees the string the call allocated.
        let uri = unsafe {
            args.Request()?.Uri(&mut uri)?;
            take_pwstr(uri)
        };
        if policy.allows(&uri, Source::Any) {
            return Ok(());
        }
        eprintln!("figure filter refused {uri}");
        unsafe {
            let refused = env.CreateWebResourceResponse(None, 403, w!("Forbidden"), w!(""))?;
            args.SetResponse(&refused)
        }
    }));
    let mut token = 0_i64;
    unsafe { webview.add_WebResourceRequested(&handler, &mut token)? };
    Ok(kind)
}
