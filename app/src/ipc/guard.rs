//! The invoke handler the shell registers: every call passes the global argument limits
//! (`validate::payload`) before tauri-specta dispatches it to its command (SEC-32). A call over a
//! limit is answered with `E_INVALID_ARGUMENT` and the command never runs.

use tauri::Runtime;
use tauri::ipc::Invoke;

use super::validate::{self, IpcLimits};

/// Wraps `dispatch` (tauri-specta's handler) with the limits check.
pub fn guarded<R: Runtime>(
    limits: IpcLimits,
    dispatch: impl Fn(Invoke<R>) -> bool + Send + Sync + 'static,
) -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    move |invoke| match validate::payload(invoke.message.command(), invoke.message.payload(), &limits) {
        Ok(()) => dispatch(invoke),
        Err(e) => {
            invoke.resolver.reject(e);
            true
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use serde_json::{Value, json};
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder, mock_context, noop_assets};
    use tauri::webview::InvokeRequest;

    use super::*;

    /// The origin the app's own pages are served from, which the ACL treats as local: wry serves the
    /// `tauri` protocol as `http://tauri.localhost` on Windows (and Android), `tauri://localhost`
    /// elsewhere. Any other origin is remote and gets no capability, so `echo` would be refused by
    /// the ACL before the guard ever saw it.
    const LOCAL_ORIGIN: &str =
        if cfg!(any(windows, target_os = "android")) { "http://tauri.localhost" } else { "tauri://localhost" };

    /// Calls `echo` on a mock app whose dispatcher counts its runs, with the guard in front of it.
    fn call(body: Value, runs: &Arc<AtomicUsize>) -> Result<Value, Value> {
        let counter = Arc::clone(runs);
        let dispatch = move |invoke: Invoke<MockRuntime>| {
            counter.fetch_add(1, Ordering::SeqCst);
            invoke.resolver.resolve("ran");
            true
        };
        let app = mock_builder()
            .invoke_handler(guarded(IpcLimits::default(), dispatch))
            .build(mock_context(noop_assets()))
            .unwrap_or_else(|e| panic!("{e}"));
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap_or_else(|e| panic!("{e}"));
        let request = InvokeRequest {
            cmd: "echo".into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: LOCAL_ORIGIN.parse().unwrap_or_else(|e| panic!("{e}")),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        };
        get_ipc_response(&webview, request).map(|b| b.deserialize::<Value>().unwrap_or_else(|e| panic!("{e}")))
    }

    #[test]
    fn ipc_a_call_within_the_limits_reaches_the_command() {
        let runs = Arc::new(AtomicUsize::new(0));
        assert_eq!(call(json!({ "query": "a".repeat(64 * 1024) }), &runs), Ok(json!("ran")));
        assert_eq!(runs.load(Ordering::SeqCst), 1);
    }

    /// SEC-32: an over-limit call is answered with E_INVALID_ARGUMENT and the command never runs.
    #[test]
    fn ipc_an_over_limit_call_is_rejected_before_the_command_runs() {
        let runs = Arc::new(AtomicUsize::new(0));
        let over = [
            json!({ "text": "a".repeat(64 * 1024 + 1) }),
            json!({ "items": vec![0; 10_001] }),
            json!({ "parts": vec!["a".repeat(60 * 1024); 18] }),
        ];
        for body in over {
            let err = call(body, &runs).err().unwrap_or_else(|| panic!("accepted"));
            assert_eq!(err["code"], "E_INVALID_ARGUMENT", "{err}");
            assert_eq!(err["retryable"], false);
        }
        assert_eq!(runs.load(Ordering::SeqCst), 0, "the command ran despite the guard");
    }
}
