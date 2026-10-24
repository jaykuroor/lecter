# Progress

<!-- Everything above the LOG marker is printed into every session by scripts/next.py. Keep it ≤ 40 lines and true. Rewrite it each session (handoff skill). -->

## Current state
- Runs: `scripts/dev.sh` opens one Lecter window (Tauri 2) on the UI shell with Vite hot reload. `pnpm -C ui run dev` shows the shell in a browser against the mocked core. CI (`.github/workflows/ci.yml`: lint, test on 3 OSes, e2e) is written but has never run: it runs on the first push.
- Milestone: M0 · last done: F-013 CI workflows and verify stages · gate: none
- Resume point (2026-10-24 10:14): merging CI-c1493e7 from fix/ci-c1493e7
- In progress: none
- Watch out: CI is UNVERIFIED until the first push (macOS and Windows especially; check that setup-node reads engines.node and that pnpm/action-setup accepts package_json_file). init.sh and verify.sh now pick Node 24 (falling back to /usr/bin/node-24, D-061), keep pnpm's store out of the checkout and run every lint in worktrees; the same env block is inline in both (D-074), so jscpd may flag it. Something else (likely the edit-format hook) can still create `.pnpm-store/` in a worktree, and it isn't git-ignored. No GUI starts inside the Claude sandbox, so window checks and F-016's e2e-app need Jay. Release builds need `--features custom-protocol` (D-069). WebKit isn't installed locally (`--stage e2e` fails here). The sandbox can't push (no ~/.ssh); Jay pushes.
- Next up: F-014 code-health gates, then the M0 spikes.

<!-- LOG -->

## Log (newest first)

### 2026-10-24 · CI-5e897b2 · done
- Fixed: windows-2025 CI failed installing gitleaks because Git Bash's sha256sum prefixed the hash with `\`. install-gitleaks.sh now hashes via stdin; a test rejects passing a path. UNVERIFIED-ON: windows until the next CI run.
- Code: .github/scripts/install-gitleaks.sh, crates/harness/tests/ci.rs
- Watch out: any other script that runs `sha256sum <path>` on Windows paths hits the same prefix.

### 2026-10-24 · F-013 · done
- Built: CI pipeline (`lint`, `test` on ubuntu-24.04/macos-15/windows-2025, `e2e`) calling `verify.sh --stage`, a shared setup action, a checksum-verified gitleaks, and weekly grouped Dependabot. `init.sh --check` lists missing tools with Fedora commands. init and verify work on system Node 22 and in worktrees.
- Code: .github/workflows/ci.yml, .github/actions/setup/action.yml, .github/scripts/install-gitleaks.sh, .github/dependabot.yml, scripts/init.sh, scripts/verify.sh
- Tests: crates/harness/tests/ci.rs (14 tests)
- Decisions: D-072 to D-074
- Follow-ups: first push confirms CI (UNVERIFIED-ON macos, windows)

### 2026-10-24 · F-012 · done
- Built: `app/` Tauri 2 shell (crate lecter-app) with identifier, version and the SEC-30 CSP; one capability granting only `allow-app-info`; devtools off in release; release builds can't compile without the embedded UI. `lecter_core::identity::APP_ID` is read from tauri.conf.json at build time. `scripts/dev.sh` runs Vite and the app with hot reload.
- Code: app/, crates/core/build.rs, crates/core/src/identity.rs, scripts/dev.sh, deny.toml (licence line by Jay), root Cargo.toml members
- Tests: app/tests/config.rs, app/tests/capabilities.rs, app/src/ipc unit tests, crates/core identity tests, crates/harness/tests/workspace.rs (licence list)
- Decisions: D-067 to D-071
- Follow-ups: kit fixes in "Watch out"; SEC-36 isolation pattern is measured by its own feature

### 2026-10-24 · F-011 · done
- Built: `ui/` with Vite + SolidJS + strict TypeScript, Biome, Vitest (jsdom) and Playwright. A mocked core replaces Tauri IPC (`ui/e2e/mock-core/`); one `@smoke` test loads the app shell in Chromium. Node 24.18.0 and pnpm 12.15.0 pinned in package.json.
- Code: ui/src, ui/e2e/mock-core, ui/package.json, ui/vite.config.ts, ui/playwright.config.ts, ui/biome.json
- Tests: ui/test/scaffold.test.ts, ui/src/**/*.test.ts(x), ui/e2e/shell.spec.ts, ui/e2e/dev-mock.spec.ts
- Decisions: D-061 to D-066
- Follow-ups: kit fixes in "Watch out" (Node 24 on PATH, pnpm store, worktree lints, Playwright download host, WebKit)

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
