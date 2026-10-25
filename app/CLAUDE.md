# app/ (Tauri 2 shell)

Commands, channels, the `lecter://` protocol, windows, capabilities, packaging.
Spec: `01-architecture.md#processes`, `#packaging`; `13-security.md`; `08-figures.md#sandbox-pages`.

## Invariants

- The shell stays thin: commands validate input and call `core`, `ai` or `index`. No business logic here.
- Requests go through Tauri commands, streams through Tauri channels. Every command and event is a Rust type exported to `ui/src/core/bindings.ts` by tauri-specta (`18-contracts.md#ipc`); `verify.sh` fails on stale bindings. Each command validates its arguments in Rust (SEC-32).
- Images are served only through `lecter://` from the content-hash cache. Never send image bytes through JSON or IPC.
- Capabilities: an allow-list per window. The figure frame window or iframe gets nothing.
- CSP on the main webview: no remote content, no `eval`, no inline scripts. Figure pages get their own CSP with no network.
- Startup: cold open of a lecture in < 400 ms. Defer everything that isn't needed for first paint (catalog refresh, indexing, pre-warm happen after paint).
- Updates are signed. Builds are signed per OS (credentials come from Jay; see QUESTIONS).
- Debug-only test hooks (embedded WebDriver, `LECTER_TEST_*`, devtools) live behind `cfg(debug_assertions)`; `scripts/check_release_binary.sh` proves release builds don't have them.

## Learned
- Inside the Claude Code sandbox no window can open: AF_UNIX `socket()` is denied (GTK can't reach X/Wayland) and Xvfb can't write `/tmp/.X<n>-lock`, so it never listens; `cargo run -p lecter-app` stops at "Failed to initialize GTK" (F-012)
- Without `tauri/custom-protocol` a build loads `build.devUrl`; main.rs's `compile_error!` stops such release builds, so build releases with `--features custom-protocol` (F-012)
- Cargo ignores `cfg(debug_assertions)` in `[target.'cfg(..)'.dependencies]` (warns, then compiles the crate into release builds too); gate test-only deps behind the `test-hooks` feature instead (F-016)
- `src/bin/export-bindings.rs` compiles the shell's modules with `#[path]` (the app has no lib target): a new crate-root module that `ipc/` uses must be added there too, or the bindings binary won't build (F-017)
- After changing a command's signature or an IPC type, run `cargo run -p lecter-app --bin export-bindings` and commit `ui/src/core/bindings.ts`; `contract()` in `ipc/mod.rs` and `names.rs` must list the same commands (F-017)
