# Progress

<!-- Everything above the LOG marker is printed into every session by scripts/next.py. Keep it ≤ 40 lines and true. Rewrite it each session (handoff skill). -->

## Current state
- Runs: `cargo run -p lecter-cli` prints `lecter 0.0.1`. No app or UI yet.
- Milestone: M0 · last done: F-010 Rust workspace scaffold · gate: none
- Resume point (2026-10-24 00:07): merging F-011 from feat/F-011-ui-scaffold
- In progress: none
- Watch out: Node is pinned to 24.18.0 (D-058). Jay's machine has it as `node-24`, but plain `node` still runs 22.23.1; point `node` at 24 before F-011.
- Next up: F-011 UI scaffold (set `packageManager` and `engines.node` per D-058), then F-012 to F-014 and the M0 spikes.

<!-- LOG -->

## Log (newest first)

### 2026-10-23 · F-010 · done
- Built: Cargo workspace with all nine crates (`lecter-core`, `-parse`, `-models`, `-index`, `-ai`, `-cas`, `-harness`, `-cli`, `-fake-provider`), each with a smoke test. The `lecter` binary prints its version. Toolchain pinned. Also deny.toml, clippy.toml, rustfmt.toml and .gitattributes.
- Code: Cargo.toml, Cargo.lock, rust-toolchain.toml, deny.toml, clippy.toml, rustfmt.toml, .gitattributes, crates/*/, tests/fake-provider/
- Tests: crates/harness/tests/workspace.rs (6 repo-shape tests), crates/cli/tests/version.rs, one smoke test in each crate's src
- Decisions: D-058, D-059, D-060
- Follow-ups: none

### 2026-10-24 · kit · done (rebuild after review)
- Built: walking skeleton milestone M0.5 and milestone gates; 141 features with owned paths, evidence, protected checks and security reviews; real-app driving (embedded WebDriver, lecter-harness, drive-app skill, evidence); IPC contract spec (tauri-specta), robustness and security specs; Claude Code sandbox with a narrow allowlist; lints for test weakening, dependencies, architecture, file size, secrets and copied private text; live keys only through scripts/live.sh; security reviewer; docs/design from the concept demo; two-account orchestration with resume points.
- Decisions: D-035 to D-057; D-021, D-026, D-027, D-031 updated; D-028 and D-034 superseded.
- Tested: a dry run in sandboxed Claude Code sessions on a scratch copy (session start, next feature, guard blocks, test-weakening lint, private-corpus symlink and copy checks, init and verify). It found three kit bugs, fixed under D-057.
- Follow-ups: Jay runs the first session on Fedora (build guide).

### 2026-10-24 · kit · done
- Built: v0 spec (docs/spec 00–16), 76 features with EARS criteria (docs/features.json), build kit (AGENTS.md, PROMPT*.md, folder CLAUDE.md files, skills, reviewer/builder/gardener agents, hooks, scripts), CI/CD spec and docs/TESTING.md, public README, LICENSE, CHANGELOG.
- Decisions: D-001 to D-034.
- Follow-ups: none
