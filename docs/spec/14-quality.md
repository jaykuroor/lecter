# 14 · Quality: budgets, tests, evidence, definition of done

## Performance budgets

These are CI gates from the walking skeleton on (milestone M0.5). Every feature after it keeps them green.

| Id (`tests/perf/budgets.json`) | Target | How measured |
|---|---|---|
| `keystroke_p99_ms` | p99 < 8 ms | Trace of 500 keystrokes in the 200-slide fixture lecture (real app via WebDriver; mocked core in Playwright as the fast check). The real-app trace gates only with hardware rendering (see rules) |
| `cold_open_ms` | < 400 ms goal; the gate is per OS (see rules) | Process start to first buffer paint of the fixture lecture; median of 5 launches of the e2e-app `cold-open` flow. Gates only on the maintainer's machine (see rules) |
| `idle_rss_mb` | Per OS (see rules); Linux < 460 MB | Memory of all app processes, webview included, 60 s after opening the fixture lecture |
| `rss_300_slides_mb` | Per OS (see rules); Linux < 500 MB | Memory with the 300-slide fixture lecture open and scrolled end to end |
| `idle_cpu_pct` | < 0.5% average | 5-minute idle sample |
| `ttft_overhead_ms` | < 20 ms | Gloss request against the fake provider with 0 ms latency |
| `tier1_p95_ms` | < 100 ms | Fixture course: 1 textbook (~600 pages) + 10 lectures (from M4) |
| `parse_100_pages_ms` | < 1,000 ms | 100-page text-layer fixture PDF |
| `uncached_tokens_a_p95` | ≤ 2,500 | Logged usage on the eval set (from M3) |
| `crash_loss_ms` | ≤ 250 ms | Kill -9 during typing; compare the journal |
| `ui_main_chunk_kb_gz` | ≤ 250 KB | Size of the main UI chunk after `vite build`, gzipped |
| `installer_mb` | `.deb` ≤ 25 MB, `.rpm` ≤ 25 MB, macOS `.dmg` ≤ 30 MB, Windows `.exe` ≤ 20 MB, AppImage ≤ 110 MB (it bundles WebKitGTK); PDFium included | Release-profile bundle sizes (nightly, from M0.5); the first measurement goes in a D-entry |

Rules:
- A budget is born with the feature that makes it measurable, and its entry lists the milestone it starts gating (`"from"`). Entries without a measurement yet print `PENDING` and fail once their milestone is done.
- `kind: timing` budgets: shared CI runners are noisy, so with `--ci` a timing value gets a ×1.5 allowance, and a value over it is measured once more: the budget fails only if both runs are over ×1.5 (the report keeps both values). Locally (`--quick`, `--only`) they gate at ×1. Memory, size and token budgets are exact everywhere. The gardener tracks values between ×1 and ×1.5.
- Memory budgets have a target per OS (`budgets.json` `"per_os"`). They count every process, Lecter's own included, by its proportional share (Linux PSS; macOS `phys_footprint`; Windows private working set), because shared WebKit and system libraries would otherwise be counted once per process (D-161); RSS of all processes stays an info line. Each OS's target is its first release-build measurement plus 10 %, rounded up to the next 10 MB, recorded in a D-entry (Linux: all-PSS 414.6 and 450.7 MB (D-139) → 460 and 500 MB; the macOS 300-slide sample is taken after the settle). Targets may only go down afterwards.
- `keystroke_p99_ms` from the real app gates only where the webview renders on a GPU: locally (`--only keystroke_p99_ms`, run by the maintainer at each milestone gate). CI runners render in software (Xvfb/llvmpipe, WARP), so with `--ci` the real-app value prints `REPORT` and never fails; the mocked-core Playwright trace gates every push.
- `cold_open_ms` is the median of 5 launches, gated at ×1 (the ×1.5 allowance and re-measure don't apply). It has per-OS targets (`"per_os"`): each is the first release-build measurement on its CI runner (ubuntu-24.04, macos-15, windows-2025) plus 10 %, rounded up to the next 10 ms, recorded in a D-entry (D-152); targets only go down. An OS without a target prints `REPORT`. CI runners render in software (about 590 ms of the Linux CI median is WebKitGTK start-up), so the real-app value gates only locally, at each milestone gate, against a target from the maintainer's machine (median of 5 + 10 %, D-155). With `--ci` it prints `REPORT` and never fails, like `keystroke_p99_ms`.
- Shared VM runners can't tell a regression from noise on memory and start-up (the same code swung ~200 MB of macOS WebContent footprint and ~100 ms of Linux cold open). So with `--ci`, the real-app `cold_open_ms`, `rss_300_slides_mb` and `idle_rss_mb` print `REPORT` on every OS and never fail, and so does the macOS mocked-core keystroke check (Linux keeps gating it). They gate on the maintainer's machine at each milestone gate (median of 5 + 10 %), and a same-job main-vs-branch comparison (F-182) catches real regressions on CI (D-225). The macOS 300-slide memory is the median of several settles, not one sample.
- `ttft_overhead_ms` and `idle_cpu_pct` may have per-OS targets (`"per_os"`, measurement + 10 %, recorded in a D-entry, only going down): macOS ttft, after checking the measure's one-frame quantisation; Windows idle CPU, only if the idle-redraw card (F-180) shows the WebView2 baseline can't be cut (D-161).
- Nothing animates while idle: after 10 s without input or a running stream, the window has no running animation or transition and no repeating DOM work. The caret blinks for 10 s after the last input, then stays solid until the next one (GTK's behaviour).
- Never loosen a budget to pass. Measure, record a D-entry, and ask the maintainer. `tests/perf/budgets.json` is a protected file (`#protected-checks`), and the test-weakening lint fails on any loosened value.

## Perf harness

Built in the walking skeleton (F-025). `tests/perf/budgets.sh [--ci] [--only <id>]` runs each measurement script listed in `budgets.json`, prints one line per budget (`PASS keystroke_p99_ms 5.1 / 8`), writes `tests/perf/report.json`, and exits non-zero on a breach. It runs in the `perf` job on every code push (Linux) and nightly on all three OSes (`16-ci-cd.md`). Builders run `--only` for the budgets their change can affect and attach the output as evidence.

## Test layers

| Layer | Tooling | Scope |
|---|---|---|
| Unit | `cargo nextest`, Vitest | Every module |
| Property | `proptest` | Document model, anchoring, journal replay, settings precedence, path handling |
| Snapshot | `insta` | Parser output, prompt assembly (cache stability) |
| Fuzz | `cargo-fuzz` (nightly CI) | PDF, PPTX, Markdown, JSONC, journal readers |
| Contract | Generated bindings + typed mock core | IPC drift (`18-contracts.md#ipc`) |
| Harness | `lecter-harness` (debug-only binary) | Core behaviour as JSON with no GUI: import, parse, search, assemble a prompt, render a lecture to Markdown |
| UI e2e (fast) | Playwright against the mocked core | User flows; runs in every local verify (`@smoke`) |
| App e2e (real) | WebdriverIO + the embedded WebDriver plugin, debug builds | The real app on Linux, Windows and macOS (`16-ci-cd.md`) |
| Visual | WebDriver screenshots compared with `docs/design/reference/`, per-OS baselines once the skeleton exists | Layout and look |
| Parse corpus | `tests/corpus/` + scorer | CER, LaTeX exact match, render-back per material type, against `tests/corpus/thresholds.json` |
| AI eval | `tests/ai-eval/` | 50 fixed questions; live only through `scripts/live.sh` |
| Chaos | `tests/fake-provider/` | Slow first token, 429, 5xx, dropped streams, malformed SSE, unknown events |
| Soak | 30-minute and 3-hour simulated sessions | Memory flat, latency stable |

How to add each kind: `docs/TESTING.md`. How CI runs them: `16-ci-cd.md`. Tests never call real providers; live runs go only through `scripts/live.sh`.

## Mutation testing

Coverage shows a line ran, not that a test would notice it being wrong. `scripts/mutants.py` (cargo-mutants for Rust, Stryker with the Vitest runner for `ui/src`) mutates only the lines a change touched and reruns their tests, capped at about 10 minutes. It runs in the default `scripts/verify.sh` set, locally only (CI never runs it; it is skipped during a merge). A surviving mutant fails the check unless a commit carries `Mutant-Equivalent: <file> - <mutation> - <reason>` and the reviewer accepts the reason. `nightly.yml` runs the whole tree and reports the score; there is no score threshold, because the gate is the changed lines. Rules for tests that catch bugs: `docs/TESTING.md#tests-that-catch-bugs`.

## Evidence

Each feature lists the evidence it needs in `features.json` → `evidence`. The builder saves it under `.evidence/<F-id>/` (git-ignored) and `python3 scripts/evidence.py check F-0NN` confirms it exists. The reviewer reads the log tails, opens screenshots for the criteria about what the user sees, and compares them with the criteria. For a spike, the orchestrator checks the measurement log instead.

| Item | File | What it shows |
|---|---|---|
| `screenshot:<state>` | `<state>.png` | The real app in that state, taken with the `drive-app` skill. UI features compare it with the matching crop in `docs/design/reference/` |
| `log:<name>` | `<name>.log` | Command output: the failing-then-passing test run, a harness call, a measurement |
| `perf` | `perf.txt` | `tests/perf/budgets.sh --only …` output for the budgets the change can affect |
| `harness:<name>` | `<name>.json` | `lecter-harness` output proving core behaviour |

## Protected checks

Builders can add tests, snapshots, fixtures and budget entries, but they can't weaken the checks that judge them. The guard hook (`scripts/hooks/guard.py`, lists `PROTECTED` and `KIT_FILES`, the single source) blocks edits, including shell writes, to existing:

- **checks:** `scripts/verify.sh`, `tests/perf/budgets.json`, `tests/corpus/thresholds.json`, `.github/workflows/**`, `deny.toml`, `clippy.toml`, `rustfmt.toml`, `rust-toolchain.toml`, `ui/biome.json`, `ui/tsconfig.json`, `ui/playwright.config.ts`, `tests/e2e/wdio.conf.ts`, `ui/knip.json`, `ui/.jscpd.json`, snapshot files and visual baselines. A feature may edit one only when it lists it under `protected` (for example F-025 creates the budgets).
- **kit files** (the maintainer only): `.claude/settings*.json`, `.claude/agents/**`, `scripts/hooks/**`, the lint scripts, `scripts/add_dep.py`, `scripts/live.sh`, `scripts/deps_preapproved.txt`, `.gitleaks.toml`, `scripts/tests/**`.

`scripts/check_tests.py` (lint stage) compares the change with its base and fails when it:

- deletes a test file or a test function, or a `proptest!` block;
- adds `#[ignore]`, `.skip`, `.only`, `.fixme`, `xit`, `xdescribe`, or Playwright/WebdriverIO retries;
- loosens a value in `budgets.json` or `thresholds.json`;
- changes an existing snapshot;
- adds a test that asserts nothing, asserts a constant, compares a value with itself, or only checks `is_ok`/`is_some`/`toBeDefined`/`toBeTruthy`/`not.toBeNull` (and warns when a changed test file has more than 3 mocks).

A deliberate exception needs a commit trailer the reviewer must accept: `Test-Removed: <path::name> — <reason>`, `Snapshot-Changed: <path> — <reason>`, `Test-Smell-Ok: <path::name> — <reason>`, or `Budget-Changed: <id> — D-0NN` (a decision by the maintainer).

`scripts/check_sec_ids.py` (lint stage) fails when a SEC-xx or ROB-xx requirement (`13-security.md`, `17-robustness.md`) is cited by no feature card and isn't listed in the script as kit-only or covered by a named card. A requirement no card names is one no builder reads.

## Definition of done

This is the one definition; every other file links here.

1. Every acceptance criterion has an automated test that failed on an assertion before the change and passes after it, with an edge-case test where the criterion has an input, a limit or an error path (spikes: a reproducible measurement script and a D-entry).
2. `scripts/verify.sh` prints `VERIFY OK` (format, lint, types, tests, the e2e smoke set, the kit checks, secret scan, private-corpus check, test-weakening and test-smell lint, mutation testing of the changed lines, and the budgets the change touches).
3. The evidence listed for the feature exists and matches the criteria (`python3 scripts/evidence.py check F-0NN`).
4. No placeholder code: no `todo!()`, `unimplemented!()`, `TODO` without an issue reference, or mock data in production paths.
5. A fresh-context `reviewer` left no unresolved blocker or major (with `SECURITY` for features with `reviews: ["security"]`; minors go to PROGRESS "Watch out"). Spikes: the orchestrator checked the measurement log and the D-entry instead. The `security-reviewer` runs once per milestone gate, and on the deep-security cards listed in `PROMPT.orchestrate.md`.
6. The handoff is written: PROGRESS, D-entries, CHANGELOG line, Learned notes (`handoff` skill).

### When the criteria can't be met

If a criterion is impossible as written (it contradicts another, the platform can't do it, or a budget can't be met with any reasonable design), don't bend the test to pass. Stop and report `IMPOSSIBLE` with evidence: what you tried, the measurements, and the smallest spec change that would make it possible. That is a successful outcome; a gamed test is not.
