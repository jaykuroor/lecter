# crates/: Rust workspace conventions

Applies to every crate. Crate-specific rules are in each crate's `CLAUDE.md`.

- Crate names are `lecter-<folder>` (`lecter-core`, `lecter-parse`, …). Shared versions go in root `[workspace.dependencies]`.
- Crate edges: the table in `01-architecture.md#repository-layout`, enforced by `scripts/check_arch.py` (lint stage). `parse` and `models` are separate binaries that talk to `core` over stdin/stdout (`18-contracts.md#worker-protocol`).
- `unwrap`/`expect` are denied by workspace lints; tests opt out with `#[allow(clippy::unwrap_used)]`. `clippy.toml` disallows blocking calls (`std::thread::sleep`, blocking fs) in async code.
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

