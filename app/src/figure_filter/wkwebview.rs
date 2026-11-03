//! WKWebView: the policy's content rule list, compiled by `WKContentRuleListStore` and added to the
//! webview's `WKUserContentController`. objc2-web-kit's feature set in the tree (wry's) has no
//! content rule list classes, so this sends the messages by name. Runs on the main thread.

use std::cell::Cell;

use block2::RcBlock;
use objc2::msg_send;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject};
use objc2_foundation::NSString;
use tauri::webview::PlatformWebview;

use super::Done;
use super::policy::Policy;

pub fn install(platform: &PlatformWebview, policy: &Policy, done: Done) {
    let Some(store_class) = AnyClass::get(c"WKContentRuleListStore") else {
        done(Err("WebKit has no WKContentRuleListStore".to_owned()));
        return;
    };
    // SAFETY: `inner()` is Tauri's live WKWebView; retaining it keeps it valid until the
    // compile answers.
    let Some(webview) = (unsafe { Retained::retain(platform.inner().cast::<AnyObject>()) }) else {
        done(Err("no WKWebView".to_owned()));
        return;
    };
    // SAFETY: `defaultStore` is a class method returning the shared store (or nil).
    let store: Option<Retained<AnyObject>> = unsafe { msg_send![store_class, defaultStore] };
    let Some(store) = store else {
        done(Err("no default WKContentRuleListStore".to_owned()));
        return;
    };
    let id = NSString::from_str(&format!("lecter-figure-frames-{}", std::process::id()));
    let rules = NSString::from_str(&policy.webkit_rules());
    let done = Cell::new(Some(done));
    let answered = RcBlock::new(move |list: *mut AnyObject, error: *mut AnyObject| {
        let Some(done) = done.take() else {
            return;
        };
        if list.is_null() {
            let why = if error.is_null() {
                None
            } else {
                // SAFETY: a non-null `error` is an NSError; localizedDescription is an NSString.
                let text: Option<Retained<NSString>> = unsafe { msg_send![error, localizedDescription] };
                text.map(|t| t.to_string())
            };
            done(Err(format!("content rule list did not compile: {}", why.as_deref().unwrap_or("unknown error"))));
            return;
        }
        // SAFETY: `webview` is a retained WKWebView; its configuration's userContentController is
        // the live controller (the configuration copy shares it), and `list` a WKContentRuleList.
        unsafe {
            let config: Retained<AnyObject> = msg_send![&*webview, configuration];
            let controller: Retained<AnyObject> = msg_send![&*config, userContentController];
            let _: () = msg_send![&*controller, addContentRuleList: list];
        }
        done(Ok("content-rule-list (WKContentRuleList)"));
    });
    // SAFETY: the method takes two NSStrings and a block of (WKContentRuleList *, NSError *);
    // WebKit copies the block and calls it once, on the main thread.
    unsafe {
        let _: () = msg_send![
            &*store,
            compileContentRuleListForIdentifier: &*id,
            encodedContentRuleList: &*rules,
            completionHandler: &*answered
        ];
    }
}
