# crates/: Rust workspace conventions

Applies to every crate. Crate-specific rules are in each crate's `CLAUDE.md`.

- Crate names are `lecter-<folder>` (`lecter-core`, `lecter-parse`, …). Shared versions go in root `[workspace.dependencies]`.
- Crate edges: the table in `01-architecture.md#repository-layout`, enforced by `scripts/check_arch.py` (lint stage). `parse` and `models` are separate binaries that talk to `core` over stdin/stdout (`18-contracts.md#worker-protocol`).
- `unwrap`/`expect` are denied by workspace lints outside tests (`clippy.toml` allows them in `#[test]` and `#[cfg(test)]`). The root `clippy.toml` (async crates) bans `std::thread::sleep`, blocking `std::fs`/`std::net` calls and Tauri's identifier-based path helpers; `parse`, `models` and `harness` carry an identical sync copy without the fs/net bans. A blocking call that belongs in an async crate (a `spawn_blocking` body, a build script, a test) gets `#[allow(clippy::disallowed_methods, reason = "...")]` where it is made (F-014).
- Errors: one `thiserror` enum per crate (`Error`), with `pub type Result<T>`. Convert at crate boundaries; don't leak foreign error types in public APIs.
- Async: tokio multi-thread runtime owned by `app`. Libraries take a `Handle` or are runtime-agnostic. CPU-heavy work (parsing, embedding, BM25 build) goes to `spawn_blocking` or a worker process, never on a runtime thread.
- Cancellation: every job takes a `tokio_util::sync::CancellationToken` and checks it at await points and loop heads.
- Channels are bounded. Pick the bound on purpose and note it at the call site.
- Allocation: on hot paths (keystroke → document model, token stream → UI) pre-size buffers, avoid `String` churn, prefer `&str` and `Cow`, and measure with `cargo bench` (criterion) before and after.
- Logging: `tracing` with spans named `area.operation`. Fields never include prompt, answer, note text or keys (`log.content = false`).
- Tests: unit tests next to the code (`#[cfg(test)]`). Cross-crate and fixture tests go in `crates/<c>/tests/`. Use property tests (`proptest`) for parsers, model invariants and precedence rules.
- Public API: doc comment on every `pub` item; `#![deny(missing_docs)]` once a crate stabilises.
- Core behaviour you can check without the GUI goes through `lecter-harness` (`crates/harness`), which every feature extends rather than forks.

## Learned
- Bumping `rust-toolchain.toml` → the next cargo call makes rustup download that toolchain, which needs network to static.rust-lang.org (F-010)
- Clippy uses the nearest `clippy.toml` above a crate's manifest and never merges it with the root one; an unresolvable disallowed path warns only in crates that depend on its crate (F-014)
