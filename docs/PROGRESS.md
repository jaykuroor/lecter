# Progress

<!-- Everything above the LOG marker is printed into every session by scripts/next.py. Keep it ≤ 40 lines and true. Rewrite it each session (handoff skill). -->

## Current state
- Runs: open a lecture from the course rail (click or Enter): one CodeMirror buffer with slide headings and blocks; j/k/gg/G move between blocks, i/Esc switch modes (colours unset until F-042). `cargo run -p lecter-harness -- parse <pdf>` prints a text PDF's blocks (page, reading order, bbox) from the lecter-parse worker process (no OS sandbox yet). Open a course folder from the rail ("Open course folder" button, mouse or Enter/Space) and see its lectures/ and slides/; links out of the course are refused with E_NOT_TRUSTED. `cargo run -p lecter-harness -- course open <dir> --json` prints the same listing. The UI's IPC types are generated from the Rust commands (`cargo run -p lecter-app --bin export-bindings [--check]` → `ui/src/core/bindings.ts`); calls over the argument limits get `E_INVALID_ARGUMENT` before any command runs. `scripts/e2e-app.sh [flow] [--evidence F-0NN]` drives the real app with WebdriverIO (author only, outside the sandbox). `cargo run -p lecter-harness -- version --json` prints the version as JSON (debug-only test tool). `scripts/dev.sh` opens one Lecter window (Tauri 2) on the UI shell with hot reload. `pnpm -C ui run dev` shows the shell in a browser against the mocked core. CI (lint, test on ubuntu/macos/windows, e2e) is green on main (run 40106531943).
- Milestone: M0.5 (6/14) · last done: F-020 Skeleton: lecture buffer with Vim keys · gate: M0 passed
- Resume point (2026-10-25 22:35): CI-fa53b65 merged; waiting for the author to add the `perf` job to ci.yml and push; then `@dependabot rebase` on PR #5
- In progress: none
- Watch out: A blocking std::fs/std::net call in an async crate (core, index, ai, cas, cli, app, fake-provider) now fails clippy; use tokio or allow it at the call site with a reason (D-075). parse/models/harness have their own clippy.toml (guard-protected). `ui/knip.json` has an unknown `classMembers` rule key (harmless warning; frozen, the author fixes it). Dependabot PRs bumping `@types/node` past 24 fail and shouldn't be merged. init.sh/verify.sh set up Node 24 and the pnpm store themselves (D-074); something else (likely the edit-format hook) can still create `.pnpm-store/` in a worktree, and it isn't git-ignored. No GUI inside the Claude sandbox (AF_UNIX denied, /tmp read-only): window checks and `scripts/e2e-app.sh` runs need the author; builders save what they can and report BLOCKED for the run. WebDriver is only in `--features test-hooks` builds, not plain debug (D-094). The shell renders white until F-042 adds theme tokens. D-080's WebKitGTK keystroke trace has no card yet (Q-010). Release builds need `--features custom-protocol` (D-069). Playwright WebKit can't launch on distros Playwright doesn't support (spikes/CLAUDE.md); measure WebKit in the `mcr.microsoft.com/playwright:v1.64.1-noble` container (podman, run by the author outside the sandbox; command in spikes/editor/README.md). WebKit timers are 1 ms and it has no heap API. Performance presets await the planning session (Q-006). The sandbox can't push; the author pushes, and runs CI on a branch with `gh workflow run ci.yml --ref <branch>` when macOS/Windows results are needed before a merge. nextest fail-fast in verify.sh hides later tests after the first failure. init.sh/worktree_setup.sh fail with pnpm ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK when XDG_RUNTIME_DIR is unset (only the read-only case is handled); export XDG_RUNTIME_DIR=$TMPDIR. In the sandbox, `gh run view --log` needs `XDG_CACHE_HOME=$TMPDIR/cache`. Mutation trial on F-017 (D-101, `mutants.py --base b6ddbbb^ --minutes 5`, 92 s): 67/67 tested, 11 survived (Rust 53/53 caught, 6 unviable; UI 11 of 14 survived, all in the generated `ui/src/core/bindings.ts`): next garden decides whether mutants.py skips generated files or contract.test.ts covers them. Tauri's isolation pattern stays off (D-104); its WebKitGTK cost is unmeasured. WebDriver keys are synthetic (untrusted) events in tauri-plugin-wdio-webdriver 1.4.0: no native button activation, so key paths need app key handlers (tests/CLAUDE.md). Every WebDriver command waits ~10 s on @wdio/tauri-service's "core.invoke not available after 5s" window-focus check (noise, slows flows ~10×; needs a chore). Course listing: the 10,000-entry cap per subfolder counts hidden entries too; Space on the Open button may also click on keyup in some engines (no-op: busy guard). `.verify/` isn't uploaded when e2e-app fails in CI (`include-hidden-files: false` in ci.yml; kit change for the author). release-check.sh isn't in local verify.sh, so release leaks show only in CI. Commit 594ef4d carries a Co-Authored-By line (no history rewrite). Parse worker: no OS sandbox, no 1 GB cap, no parent-death kill yet (SEC-01/ROB-40; F-005 blocked on Q-008, F-052..54). SEC-04 image megapixels and object depth are sent but not enforced (text layer only); F-057+ must enforce them. A Hello version mismatch isn't logged by the core yet (18-contracts asks for an error log). Core worker tests need Python 3 (python3/python/py). init.sh downloads PDFium on a cold machine. The non-UTF-8 name test is compiled out on macOS (D-110). CodeMirror turns CRLF into LF, which would break F-021's byte offsets for CRLF lectures. The buffer perf check measures Chromium only (WebKit: Q-010). Embedded WebDriver: `expect($$(sel)).toHaveText([...])` fails and CodeMirror widgets go stale; read texts with one browser.execute (tests/CLAUDE.md). CI `e2e` now runs in mcr.microsoft.com/playwright:v1.64.1-noble without the shared setup (~1 min); keep its tag on the locked Playwright version. The keystroke check runs only via `pnpm -C ui run test:perf` (D-120); verify.sh doesn't run it locally until F-025 (or the author's verify.sh diff in .evidence/CI-fa53b65 report); F-020's evidence command `test:e2e -- buffer` should become `test:perf`. Buffer perf CI values between ×1 and ×1.5 include load from other specs running beside it. `add_dep.py ui` creates `.pnpm-store/` in the checkout (gitleaks then scans it for 14 min) unless `pnpm_config_store_dir` points at the home store.
- Next up: M0.5 per next.py --ready (F-021/F-022/F-028 among them). F-005 blocked on Q-008; Q-006 to Q-013 await a planning session.

<!-- LOG -->

## Log (newest first)

### 2026-10-25 · CI-fa53b65 + CI config · done
- Fixed: the keystroke check measured p99 13.9/12.7 ms (fail) and 23.0/7.5 ms (pass) in the two Playwright projects of main run 40263523685 (p50 ~5 ms). It now leaves `test:e2e` and runs alone via `test:perf` for its own `perf` CI job (D-120). The author moved `e2e` into Playwright's image (~1 min instead of 20–30), excluded `pnpm-lock.yaml` from Biome, and gave Dependabot a 14-day cooldown and ignore rules for `@types/node` and `@wdio/*` majors (PR #4 closed; #5 has WebdriverIO 9.32 only).
- Code: ui/package.json, ui/e2e/buffer-perf.spec.ts, ui/e2e/perf/exclusive.ts · Tests: ui/test/scaffold.test.ts · Evidence: .evidence/CI-fa53b65/
- Decisions: D-120 (maintainer)

### 2026-10-25 · CI-a0174c9 · done
- Fixed: main CI red after F-020: Windows refused a folder named like a lecture with PermissionDenied (now a regular-file check before open, which also stops a FIFO hang), and the buffer perf check measured 26.7 ms p99 on CI (now follows the ×1.5 + re-measure CI rule, measures without the trace recorder and without its own parallel copy). Branch CI 40258103961 green on all three OSes (e2e needed a re-run after a 30-min timeout on slow apt).
- Code: crates/core/src/lecture/mod.rs, ui/e2e/buffer-perf.spec.ts, ui/e2e/perf/{exclusive,timing-budget,probe}.ts
- Tests: crates/core/src/lecture/tests.rs (FIFO), ui/test/timing-budget.test.ts · Evidence: .evidence/CI-a0174c9/
- Decisions: D-118 (maintainer), D-119
- Review: reviewer PASS with 2 minors (Watch out).

### 2026-10-25 · F-020 · done
- Built: open a lecture from the rail (click or Enter); the whole .md shows in one CodeMirror 6 buffer with front matter, fences and titles hidden, slide headings ("Slide 1 / 2", title, source) and blocks. j/k/gg/G move by element (counts work), i/Esc switch modes. `lecture_open(course, path)` is limited to a course opened this session and `lectures/<name>.md` (canonical, in the course, UTF-8, ≤ 16 MiB). Keystroke-to-paint p99 4.2 ms on the 200-slide fixture (Chromium, mocked core). The author's WebDriver run passed (4/4).
- Code: crates/core/src/lecture/, app/src/ipc/{lecture,session}.rs, ui/src/features/buffer/, ui/src/state/lecture.ts, ui/src/core/lecture.ts, capabilities/main.json
- Tests: ui/src/features/buffer/*.test.ts(x), ui/e2e/buffer.spec.ts, ui/e2e/buffer-perf.spec.ts, tests/e2e/flows/buffer.ts, core lecture tests · Evidence: .evidence/F-020/
- Decisions: D-115, D-116, D-117 · Questions: Q-013
- Review: reviewer PASS (SECURITY on lecture_open) with 3 minors (Watch out, Q-013); the author's first run failed one step (test reading CodeMirror widgets), 1 FIX round, second run passed.
- Follow-ups: FIFO check in lecture_open; CRLF lectures before F-021.

### 2026-10-25 · F-019 · done
- Built: `lecter-parse` runs as a child process speaking the worker protocol (Hello version check, length-prefixed postcard frames); a synthetic text PDF becomes blocks with pages and reading order via PDFium. A crash, protocol mismatch, oversized frame or > 60 s gives E_PARSE_FAILED and the core stays responsive. `lecter-harness parse <pdf>` prints the blocks. CI and init.sh fetch the pinned PDFium once (actions/cache), so tests stay offline (D-108).
- Code: crates/parse/src/{proto,layout,pdf,pdfium,worker,error}.rs, crates/core/src/worker/, crates/core/src/error.rs, crates/harness/src/commands/parse.rs, scripts/init.sh, .github/actions/setup/action.yml, root Cargo.toml (workspace tokio)
- Tests: crates/parse/tests/{pdf_text,worker_process}.rs, crates/parse/src/{worker,layout}_tests.rs, crates/core/src/worker/tests.rs (Python fake workers), crates/harness/tests/{parse,init_install,ci}.rs, tests/fixtures/pdf/ · Evidence: .evidence/F-019/
- Decisions: D-111, D-112, D-113, D-114
- Review: reviewer (SECURITY) PASS with 3 minors (Watch out); branch CI first red on pre-existing main failures (fixed by CI-17ae5e6), then on the Windows abort exit code; 1 FIX round, re-check PASS; branch CI 40231663863 green on all three OSes.
- Follow-ups: sandbox and limits listed in Watch out.

### 2026-10-25 · CI-17ae5e6 · done
- Fixed: main CI red on Windows (IPC guard tests used the non-Windows origin), macOS (non-UTF-8 name fixture), release-check (`lecter-harness` in a specta doc string) and Windows e2e-app (plugin/service 1.4.0 → 1.5.0, 8.3 short path in open-course). Branch CI run 40229046760 green on all three OSes.
- Code: app/src/ipc/{guard,course}.rs, crates/core/src/course/tests.rs, tests/e2e/flows/open-course.ts, app/Cargo.toml, ui/package.json, lockfiles, bindings.ts
- Decisions: D-109, D-110
- Review: none (CI fix under 40 code lines); 2 CI rounds on the branch.

### 2026-10-25 · F-018 · done
- Built: "Open course folder" in the rail (mouse, Enter or Space) shows the course name, Lectures and Slides; every entry is canonicalised and a link out of the course fails the open with E_NOT_TRUSTED. `lecter-harness course open <dir> [--json]` prints the same listing. The author's WebDriver run passed (course-open.png).
- Code: crates/core/src/course/{mod,listing}.rs, crates/core/src/error.rs, app/src/ipc/course.rs, crates/harness/src/commands/course.rs, ui/src/{core/course.ts,state/course.ts,features/course/}, ui/src/App.tsx, ui/src/core/bindings.ts
- Tests: crates/core/src/course/tests.rs, crates/harness/tests/course.rs, ui/src/features/course/CoursePanel.test.tsx, ui/src/state/course.test.ts, tests/e2e/flows/open-course.ts · Evidence: .evidence/F-018/
- Decisions: D-105, D-106, D-107 · Questions: Q-012
- Review: reviewer (SECURITY) PASS; the author's first e2e run failed (Enter on the button: synthetic WebDriver keys don't activate buttons), 1 FIX round (app-level Enter/Space handler), re-check PASS, second e2e run passed.
- Follow-ups: the ~10 s per WebDriver command slowdown (Watch out); Q-012.

### 2026-10-25 · F-017 · done
- Built: the IPC contract is declared once in Rust and `ui/src/core/bindings.ts` is generated from it with tauri-specta; verify fails on stale bindings. One error-code list (`lecter_core::ErrorCode`) serves the app and the harness. Every call passes global argument limits (1 MB payload, string/prompt caps) in Rust before dispatch. Spike: Tauri's isolation pattern costs 0.1 ms p99 per keystroke call but 6–23 ms at 16–64 KB, so it stays off (SEC-36).
- Code: app/src/ipc/{mod,export,validate,guard,error}.rs, app/src/bin/export-bindings.rs, crates/core/src/error_code.rs, crates/harness/src/error.rs, ui/src/core/{bindings,app}.ts (commands.ts removed), ui/e2e/mock-core/*, spikes/isolation/
- Tests: app/tests/export_bindings.rs, ui/src/core/contract.test.ts, unit tests in validate.rs (incl. exact 1 MB boundary), guard.rs, error_code.rs · Evidence: .evidence/F-017/
- Decisions: D-102, D-103, D-104 · Mutation trial: see Watch out.
- Review: reviewer + security-reviewer, PASS.
- Follow-ups: WebKitGTK isolation cost unmeasured (D-104 revisit).

### 2026-10-25 · F-016 · done
- Built: test builds (`--features test-hooks`) embed a WebDriver server, so WebdriverIO drives the real app; LECTER_TEST_PICK/TRUST answer the folder dialog and trust question; `course_open` IPC command; CI jobs `e2e-app` (3 OSes) and `release-check`. The author ran both flows (shell, open-folder) outside the sandbox: pass.
- Code: app/src/{main,dialog,test_hooks}.rs, app/src/ipc/{course,error,names,mod}.rs, tests/e2e/**, scripts/e2e-app.sh, tests/e2e/release-check.sh, .github/workflows/ci.yml, ui/{package.json,pnpm-workspace.yaml}.
- Tests: app/tests/test_hooks.rs, ui/test/e2e-app-config.test.ts, unit tests in course.rs (incl. symlinks), test_hooks.rs, error.rs · Evidence: .evidence/F-016/
- Decisions: D-094 (partly supersedes D-049), D-095, D-096, D-097 · Questions: Q-010 (D-080 trace needs a card), Q-011 (card verify line)
- Review: reviewer PASS (once its auto-mode run was restarted); security 1 FIX round (symlink tests), then PASS.
- Follow-ups: Q-010, Q-011.

### 2026-10-24 · F-015 · done
- Built: `lecter-harness` (debug-only CLI, never bundled): `version [--json]`, one JSON result per call, typed `{"error":{"code",…}}` errors with exit codes. LECTER_TEST_HOME moves every config/data/cache folder under one directory (debug or `test-hooks` only); `TestEnv` gives tests a throwaway home.
- Code: crates/harness/src/{lib,main,error}.rs, commands/{mod,version}.rs; crates/core/src/{paths,testenv,error}.rs, identity.rs (APP_DIR_NAME); root Cargo.toml (workspace serde_json).
- Tests: crates/harness/tests/{cli,never_shipped}.rs; unit tests in core paths.rs and harness error.rs · Evidence: .evidence/F-015/
- Decisions: D-088, D-089, D-090, D-091, D-092, D-093
- Review: 1 FIX round (untested env read in `AppDirs::resolve`, shared serde_json, crate Error type), then PASS. Commit b6aab39 carries a Co-Authored-By line (no history rewrite).
- Follow-ups: init.sh XDG_RUNTIME_DIR unset case (Watch out).

### 2026-10-24 · F-006 · done
- Built: PDFium spike (`spikes/pdfium`). A script downloads the pinned bblanchon build for 5 targets, checks SHA-256 from memory before extracting, and a test loads it through pdfium-render and reads page-1 text from a generated PDF. Green on all three CI OSes (run 40161530691).
- Code: spikes/pdfium/ · Tests: spikes/pdfium/tests/{checksum,load}.rs · Evidence: .evidence/F-006/
- Decisions: D-084 (source), D-085 (pdfium-render), D-086 (network exception in this crate's tests), D-087 (result). Q-009 (CI cache) for planning.
- Review: 1 FIX round (reviewer: verification proof, Windows replace race, licence, Python stubs; security: same-buffer hash+extract, 2 packaging requirements), then PASS.

### 2026-10-24 · F-005 · blocked (IMPOSSIBLE on Windows)
- Built: OS sandbox spike crate (`spikes/os-sandbox`, branch `feat/F-005-os-sandbox` at the builder's last commit), with 11 tests per OS. Linux and macOS GO. Windows meets everything except "no file other than its input" (OS files granted to ALL RESTRICTED APPLICATION PACKAGES stay readable). Lockdown token attempt failed at start-up.
- Review: reviewer FIX (go/no-go line) → fixed; security review: 7 findings (input ACE, fork, inherited fds, LPAC, Landlock bits, thread sync, handle list) → fixed with tests, plus 2 carry-forward requirements. Reviewer agreed with IMPOSSIBLE.
- CI on the branch: runs 40119212625, 40119881557, 40120703752, 40153640323 and 40154388308 (spike bugs on macOS/Windows fixed along the way).
- Decisions: D-082 (spike crates in check_arch; the author applied the kit change), D-083 (per-OS result). Q-008 for planning.

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
- Built: CI pipeline (`lint`, `test` on ubuntu-24.04/macos-15/windows-2025, `e2e`) calling `verify.sh --stage`, a shared setup action, a checksum-verified gitleaks, and weekly grouped Dependabot. `init.sh --check` lists missing tools with install hints. init and verify work on system Node 22 and in worktrees.
- Code: .github/workflows/ci.yml, .github/actions/setup/action.yml, .github/scripts/install-gitleaks.sh, .github/dependabot.yml, scripts/init.sh, scripts/verify.sh
- Tests: crates/harness/tests/ci.rs (14 tests)
- Decisions: D-072 to D-074
- Follow-ups: first push confirms CI (UNVERIFIED-ON macos, windows)

### 2026-10-24 · F-012 · done
- Built: `app/` Tauri 2 shell (crate lecter-app) with identifier, version and the SEC-30 CSP; one capability granting only `allow-app-info`; devtools off in release; release builds can't compile without the embedded UI. `lecter_core::identity::APP_ID` is read from tauri.conf.json at build time. `scripts/dev.sh` runs Vite and the app with hot reload.
- Code: app/, crates/core/build.rs, crates/core/src/identity.rs, scripts/dev.sh, deny.toml (licence line by the maintainer), root Cargo.toml members
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
- Follow-ups: the maintainer runs the first session.

### 2026-10-24 · kit · done
- Built: v0 spec (docs/spec 00–16), 76 features with EARS criteria (docs/features.json), build kit (AGENTS.md, PROMPT*.md, folder CLAUDE.md files, skills, reviewer/builder/gardener agents, hooks, scripts), CI/CD spec and docs/TESTING.md, public README, LICENSE, CHANGELOG.
- Decisions: D-001 to D-034.
- Follow-ups: none
