//! WebKitGTK: the policy's content rule list as a `WebKitUserContentFilter` on the webview's user
//! content manager. webkit2gtk-rs doesn't bind the filter API, so this calls the C functions
//! (WebKitGTK 2.24+) directly. Runs on the GTK main thread.

use std::ffi::CString;
use std::ptr;

use tauri::webview::PlatformWebview;
use webkit2gtk::glib::translate::{FromGlibPtrFull, ToGlibPtr};
use webkit2gtk::{UserContentManager, WebViewExt, ffi, gio, glib};

use super::Done;
use super::policy::Policy;

/// What the compile callback needs: where to add the filter, and whom to tell.
struct Pending {
    manager: UserContentManager,
    done: Done,
}

pub fn install(platform: &PlatformWebview, policy: &Policy, done: Done) {
    let Some(manager) = platform.inner().user_content_manager() else {
        done(Err("the webview has no user content manager".to_owned()));
        return;
    };
    // The store compiles the rules into a file in the temp folder, named per process.
    let dir = std::env::temp_dir();
    let id = format!("lecter-figure-frames-{}", std::process::id());
    let (Ok(path), Ok(id)) = (CString::new(dir.to_string_lossy().into_owned()), CString::new(id)) else {
        done(Err("filter store path has a NUL byte".to_owned()));
        return;
    };
    let rules = glib::Bytes::from_owned(policy.webkit_rules().into_bytes());
    let pending = Box::into_raw(Box::new(Pending { manager, done }));
    // SAFETY: `path`, `id` and `rules` outlive the calls (save copies what it keeps); the store is
    // a new reference that the async save holds on to (GTask refs its source object), so it is
    // released right after; `pending` is reclaimed exactly once, in `saved`.
    unsafe {
        let store = ffi::webkit_user_content_filter_store_new(path.as_ptr());
        ffi::webkit_user_content_filter_store_save(
            store,
            id.as_ptr(),
            rules.to_glib_none().0,
            ptr::null_mut(),
            Some(saved),
            pending.cast(),
        );
        glib::gobject_ffi::g_object_unref(store.cast());
    }
}

/// The store's answer: add the compiled filter, or report the compile error.
unsafe extern "C" fn saved(
    store: *mut glib::gobject_ffi::GObject,
    result: *mut gio::ffi::GAsyncResult,
    data: glib::ffi::gpointer,
) {
    // SAFETY: `data` is the `Pending` boxed in `install`, handed to this callback only.
    let pending = unsafe { Box::from_raw(data.cast::<Pending>()) };
    let mut error = ptr::null_mut();
    // SAFETY: `store` and `result` are the ones GIO passes for this save.
    let filter = unsafe { ffi::webkit_user_content_filter_store_save_finish(store.cast(), result, &mut error) };
    if filter.is_null() {
        let why = if error.is_null() {
            "unknown error".to_owned()
        } else {
            // SAFETY: a non-null error from `_finish` is ours to free; from_glib_full takes it.
            unsafe { glib::Error::from_glib_full(error) }.to_string()
        };
        (pending.done)(Err(format!("content rule list did not compile: {why}")));
        return;
    }
    // SAFETY: the manager is alive (we hold a reference); add_filter takes its own reference to
    // `filter`, so ours is released after.
    unsafe {
        ffi::webkit_user_content_manager_add_filter(pending.manager.to_glib_none().0, filter);
        ffi::webkit_user_content_filter_unref(filter);
    }
    (pending.done)(Ok("content-rule-list (WebKitUserContentFilter)"));
}
