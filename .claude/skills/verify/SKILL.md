---
name: verify
description: How to run Lecter's checks fast and narrow a failure. Use while iterating on code, when verify.sh fails, or before marking a feature done.
---

# Verify

`scripts/verify.sh` prints one line per check and only the tail of failing logs. The full logs are in `.verify/<check>.log`; read them with `tail` or `grep`, not `cat`.

| Mode | When |
|---|---|
| `scripts/verify.sh --quick` | Before you start (is `main` green?) and after each step: lint + tests |
| `scripts/verify.sh` | Before `feature.py done` (it runs this itself too): adds the e2e smoke set and quick perf budgets |
| `scripts/verify.sh --full` | Gardening: adds the real-app e2e, all budgets, advisories and the full secret history |
| `scripts/verify.sh --stage <name>` | One CI stage: `lint`, `test`, `e2e`, `e2e-app`, `perf`, `full` |

`SKIP <check> (arrives with F-0NN)` is normal until that feature is done; after it, a missing tool or file is a `FAIL`.

## Narrow a failure (much faster than the full run)

| Failing check | Rerun just that |
|---|---|
| rust-tests | `cargo nextest run -p lecter-<crate> <test_name>` or `cargo test -p lecter-<crate> <test_name> -q` |
| clippy | `cargo clippy -p lecter-<crate> --all-targets -q -- -D warnings` |
| fmt | `cargo fmt --all` (the edit hook usually did it already) |
| tsc | `pnpm -C ui exec tsc --noEmit -p .` |
| lint | `pnpm -C ui exec biome check --write <file>` |
| ui-tests | `pnpm -C ui exec vitest run <file> --reporter=dot` |
| e2e-smoke | `pnpm -C ui exec playwright test <spec> --reporter=line` |
| placeholders | The listed lines contain `todo!`, `unimplemented!`, `TODO` or `FIXME`: finish the code, or write `TODO(#123)` with an issue number only if Jay asked to defer it |
| spec-refs | A feature cites a spec anchor that doesn't exist: tell Jay in QUESTIONS (you can't edit the spec or features) |
| tests-guard | `python3 scripts/check_tests.py`: you removed or weakened a test, budget, threshold or snapshot. Undo it (`14-quality.md#protected-checks`) |
| deps | `python3 scripts/check_deps.py`: a dependency lacks its trailer or needs Jay (`add-dependency` skill) |
| arch | `python3 scripts/check_arch.py`: a forbidden crate edge or missing lint config (`01-architecture.md#repository-layout`) |
| size | `python3 scripts/check_size.py`: split the file by responsibility |
| secrets | `scripts/secret_scan.sh`: stop, don't push, tell Jay (he rotates it) |
| private-corpus | `python3 scripts/check_private.py`: a private file, its name or copied text is tracked. Remove it from the commit |
| bindings-stale | `cargo run -q -p lecter-app --bin export-bindings` regenerates `ui/src/core/bindings.ts`; commit it |
| perf | `bash tests/perf/budgets.sh --only <id>`; never loosen the budget |
| e2e-app | `drive-app` skill |

On Linux without a display, wrap Tauri/WebKit e2e runs in `xvfb-run -a`.

## Rules

- A failing test is information. Find the root cause; don't edit the test to match wrong behaviour.
- Never use `#[ignore]`, `.skip`, `.only`, or lower a budget threshold to get green (the lint fails it anyway). If the criterion can't be met, report `IMPOSSIBLE`.
- **Flaky test** (passes on rerun): this is a bug. Fix the race or the timing assumption (use events, not sleeps), or block the feature with a note.
- If a check fails for reasons outside your feature (it was red before you started: `git stash; scripts/verify.sh --quick; git stash pop`), write it in PROGRESS "Watch out". Fix it only if it is small and blocks you, in a separate `chore:` commit.
