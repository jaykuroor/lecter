# Progress

<!-- Everything above the LOG marker is printed into every session by scripts/next.py. Keep it ≤ 40 lines and true. Rewrite it each session (handoff skill). -->

## Current state
- Runs: `scripts/dev.sh` opens one Lecter window (Tauri 2) on the UI shell with hot reload. `pnpm -C ui run dev` shows the shell in a browser against the mocked core. CI (lint, test on ubuntu/macos/windows, e2e) is green on main (run 40106531943).
- Milestone: M0 spikes (F-005, F-006 left), then M0.5 · last done: F-001 Spike: CodeMirror lecture surface · gate: M0 passed
- Resume point (2026-10-24 11:54): merging F-001 from feat/F-001-editor-spike
- In progress: none
- Watch out: A blocking std::fs/std::net call in an async crate (core, index, ai, cas, cli, app, fake-provider) now fails clippy; use tokio or allow it at the call site with a reason (D-075). parse/models/harness have their own clippy.toml (guard-protected). `ui/knip.json` has an unknown `classMembers` rule key (harmless warning; frozen, the author fixes it). Dependabot PRs bumping `@types/node` past 24 fail and shouldn't be merged. init.sh/verify.sh set up Node 24 and the pnpm store themselves (D-074); something else (likely the edit-format hook) can still create `.pnpm-store/` in a worktree, and it isn't git-ignored. No GUI inside the Claude sandbox (window checks and F-016 e2e-app need the author). Release builds need `--features custom-protocol` (D-069). Playwright WebKit can't launch on Fedora 44; measure WebKit in the `mcr.microsoft.com/playwright:v1.64.1-noble` container (podman, run by the author outside the sandbox; command in spikes/editor/README.md). WebKit timers are 1 ms and it has no heap API. The editor's WebKit keystroke budget is decided by the real-app trace in F-016 (D-080), and performance presets await the planning session (Q-006). The sandbox can't push; the author pushes.
- Next up: F-005 Spike: parse-worker OS sandboxes, then F-006.

<!-- LOG -->

## Log (newest first)

### 2026-10-24 · F-001 · done
- Built: throwaway CodeMirror 6 + Vim + KaTeX + gloss lecture-surface spike (200-slide synthetic fixture) and a Playwright measurement and profiling script. Chromium GO (novsync p99 4.8–5.2 ms). Headless WebKit is NO-GO end to end (work p99 11–12 ms; sync p99 7 ms with the Markdown parse off). Lazy KaTeX/markdown took the main chunk from 289 to 140 KB gz.
- Code: spikes/editor/ · Tests: spikes/editor/measure.mjs, profile.mjs · Evidence: .evidence/F-001/
- Decisions: D-079 (spike's own packages), D-080 (keep CM6 with conditions; F-016 decides), D-081 (Performance/Balanced/Quality presets, Balanced default). Q-006 for the planning session.
- Review: 1 FIX round (evidence log regenerated, WebKit heap stated as unmeasurable), then PASS.

### 2026-10-24 · CI-4ec6f29 + M0 gate · done
- Fixed: under CI, init.sh installs only from the lockfiles (M0 security review, Q-005, D-078); harness lint tests run Python in UTF-8 (Windows console failure on check_arch's "→").
- Code: scripts/init.sh · Tests: crates/harness/tests/init_install.rs, lint_gates.rs, common/mod.rs
- M0 gate passed: the author tried `pnpm -C ui run dev` and `scripts/dev.sh` (blank page titled "Lecter"; colour tokens arrive with F-042). No gate notes. Milestone security review: one finding, fixed above.
- Follow-ups for the author (kit): `sys.stdout.reconfigure(encoding="utf-8")` in scripts/check_*.py.

### 2026-10-24 · F-014 · done
- Built: the lint stage enforces unwrap/expect outside tests, blocking std::fs/std::net and thread::sleep bans in async crates, the Tauri identifier-path ban, jscpd (30+ line copies in ui/src, crates, app/src), knip (unused exports), check_arch and check_size. Each gate has fixture evidence of failing, then passing.
- Code: clippy.toml, crates/{parse,models,harness}/clippy.toml, ui/.jscpd.json, ui/knip.json, tests/fixtures/lint/clippy/
- Tests: crates/harness/tests/lint_gates.rs, ui/test/lint-gates.test.ts
- Decisions: D-075 to D-077 (D-075 supersedes D-059)
- Follow-ups: knip.json `classMembers` key (author); guard now protects crates/*/clippy.toml (author's commit c53127d)

### 2026-10-24 · CI-c1493e7 · done
- Fixed: Vitest crashed on windows-2025 (`file:///@solid-refresh` is an invalid file URL) because vite-plugin-solid injected HMR in test mode. ui/vite.config.ts sets `solid({ hot: mode !== "test" })`; dev and e2e keep HMR. UNVERIFIED-ON: windows until the next CI run.
- Code: ui/vite.config.ts · Tests: ui/test/solid-refresh.test.ts

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
