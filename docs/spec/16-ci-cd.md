# 16 · CI/CD

There is no production server. CI/CD exists for two reasons:

- to stop a session from breaking what earlier sessions built;
- to prove Lecter builds and passes on the platforms nobody runs locally (maintainers build on Linux, so macOS and Windows are only ever exercised in CI).

Repository: `github.com/jaykuroor/lecter`, default branch `main`.

## Rules

1. **One entry point.** CI runs `scripts/verify.sh --stage <name>`, exactly what sessions run locally. Logic lives in the script, never only in YAML. If CI needs a new check, add it to `verify.sh` first.
2. **`main` is always green.** A red `main` stops the line: the next unit of work is fixing it, before any feature is merged.
3. **No secrets in CI.** Tests use the fake provider. Only the release workflow reads secrets, and it still works (unsigned) without them.
4. **Stable job names.** Branch protection and status checks refer to them. Never rename `lint`, `test (…)`, `e2e`, `e2e-app (…)`, `perf` or `release-check` without a D-entry.
5. **Least privilege.** Every workflow starts with `permissions: contents: read` and widens per job only where needed. Third-party actions are pinned by commit SHA, with the version in a trailing comment.
6. **Fast.** `ci.yml` should finish in under 20 minutes wall-clock. If it grows past that, the gardening session fixes it (caching, splitting, test speed), never by dropping checks.
7. **Workflows are protected files** (`14-quality.md#protected-checks`). Only features that list them in `protected` may change them.
8. **macOS is verified only in CI** until the maintainer has a Mac (Q-entry with a hands-on checklist before the first public release).

## Workflows

### `ci.yml`: every push to `main`, every pull request, manual dispatch

`concurrency: { group: ci-${{ github.event_name == 'pull_request' && github.ref || github.sha }}, cancel-in-progress: ${{ github.event_name == 'pull_request' }} }`. Each pushed commit is its own group, so every push to `main` gets a complete run, and only superseded PR runs are cancelled.

**Docs-only pushes.** A first `changes` job lists the files changed since the previous run (`git diff --name-only ${{ github.event.before }} ${{ github.sha }}`). A manual dispatch, a new branch or first push (`before` is all zeros), a force push (`before` is not an ancestor) or any `git diff` error counts as code. When every file is Markdown or under `docs/` (except `docs/features.json`), only `lint` runs; the other jobs are skipped (a skipped job counts as passing). Handoff commits then cost one short job.

| Job | Runner | Steps | Required |
|---|---|---|---|
| `lint` | ubuntu-24.04 | Setup → `scripts/verify.sh --stage lint`: kit tests, spec refs, features file, placeholder scan, private-corpus check, secret scan (gitleaks), test-weakening lint, architecture check, dependency check, file-length limit, stale IPC bindings, rustfmt, clippy `-D warnings`, cargo-deny (licences, bans, sources), tsc, Biome, jscpd (duplication), knip (unused code) | yes |
| `test` | matrix: ubuntu-24.04, macos-15, windows-2025 | Setup → `scripts/verify.sh --stage test`: Rust tests via nextest, Vitest, `cargo build -p lecter-app --locked` | yes |
| `e2e` | ubuntu-24.04 | Setup → Playwright browsers (chromium, webkit) → `scripts/verify.sh --stage e2e`: the full Playwright suite against the mocked core, in Chromium (stands in for WebView2) and WebKit. On failure, upload the traces | yes |
| `e2e-app` | ubuntu-24.04 (under `xvfb-run`) on every run; macos-15 and windows-2025 only on `workflow_dispatch` (the orchestrator runs it on a branch whose card needs all three OSes, `PROMPT.orchestrate.md#features-that-must-pass-on-macos-and-windows`) and nightly | Setup → `scripts/verify.sh --stage e2e-app`: debug build with the embedded WebDriver plugin, then the WebdriverIO flows in `tests/e2e/` against the real app. Upload screenshots and logs on failure | Linux yes, from the walking skeleton |
| `perf` | ubuntu-24.04 | Setup → `scripts/verify.sh --stage perf` (`tests/perf/budgets.sh --ci`). Upload `tests/perf/report.json`. Memory, size and token budgets gate exactly; a timing budget over ×1.5 is re-measured once and fails only if both runs are over (`14-quality.md#performance-budgets`) | yes, from the walking skeleton |
| `release-check` | ubuntu-24.04 | Release-profile build, then `scripts/check_release_binary.sh`: fails if the binary contains the WebDriver plugin, test hooks or devtools symbols, or any file from `tests/` | yes, from the walking skeleton |

The `Setup` steps:

- **Toolchains:** Rust from `rust-toolchain.toml`; Node + pnpm from `ui/package.json`.
- **Caches:** `Swatinem/rust-cache` and the pnpm store.
- **Linux system packages:** the Tauri 2 apt packages.
- **Cargo tools:** cargo-nextest and cargo-deny, installed as prebuilt binaries with `taiki-e/install-action`.
- **gitleaks:** a pinned release binary, checksum-verified (SEC-51).
- **Install:** `scripts/init.sh`.
- **Windows:** steps use `shell: bash` (Git Bash), and the scripts fall back from `python3` to `python`.

### `nightly.yml`: 03:00 UTC daily, plus manual dispatch

| Job | What | On failure |
|---|---|---|
| `skip-check` | First job: if the newest successful nightly ran on this same commit, every other job is skipped (needs `actions: read`) | — |
| `full` | `scripts/verify.sh --full` (adds advisories, `cargo audit`, `pnpm audit`) | Job fails |
| `e2e-app-matrix` | `scripts/verify.sh --stage e2e-app` on macos-15 and windows-2025 | Job fails; upload screenshots and logs |
| `perf-matrix` | `tests/perf/budgets.sh --ci` on ubuntu-24.04, macos-15 and windows-2025, including `installer_mb` from a release-profile bundle | Job fails; upload the reports |
| `fuzz` | Every target from `cargo fuzz list`, for each fuzzed crate, 10 minutes each on nightly Rust | Upload the crash inputs. A crash becomes a regression test plus a fix (`docs/TESTING.md#a-fuzz-target`) |
| `chaos` | Fake-provider chaos scenarios against the real AI layer | Job fails |
| `mutants` | `python3 scripts/mutants.py --full --minutes 120` on ubuntu-24.04 (cargo-mutants from `taiki-e/install-action`, Stryker from the UI lockfile), `timeout-minutes: 150` | Never fails. Uploads `.verify/mutants/score.json` and `survivors.txt`; the gardener reads them and turns survivors in risky code into test chores |
| `soak` | 30-minute simulated session (3 hours on Sundays). Memory must stay flat (±10%) and keystroke p99 within budget | Upload the report |

Nightly failures don't stop merges. The orchestrator collects them at its next gardening pass and dispatches one CI fix for whatever is still red.

### `release.yml`: push of a tag `v*.*.*`

Tags are created only by the maintainer; sessions never tag.

1. Matrix build with `tauri-apps/tauri-action` for every target in `01-architecture.md#packaging`:
   - macOS universal (`macos-15`): `.dmg` and `.app.tar.gz`.
   - Windows x64 and ARM64 (`windows-2025`): NSIS `.exe` and `.msi`.
   - Linux x64 (`ubuntu-24.04`) and ARM64 (`ubuntu-24.04-arm`): `.AppImage`, `.deb` and `.rpm`.
   - A Flatpak bundle built with `flatpak-builder` from `packaging/flatpak/` on Linux x64.
2. **Signing**, where the secret exists:
   - macOS: `APPLE_CERTIFICATE`, `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_PASSWORD`, then notarise.
   - Windows: the certificate secrets.
   - Updater: `TAURI_SIGNING_PRIVATE_KEY`.
   - Without the secrets, build unsigned and say so in the release notes.
3. **Supply chain:** produce a CycloneDX SBOM for Rust (`cargo cyclonedx`) and UI (`cdxgen`), plus `SHA256SUMS`.
4. **Draft GitHub release:**
   - body from `CHANGELOG.md` for that version;
   - attach the artifacts, SBOMs and the updater `latest.json`;
   - The maintainer reviews and publishes.

### `dependabot.yml`

Weekly updates, grouped per ecosystem (github-actions, cargo, npm in `ui/`), with at most 3 open PRs each. The maintainer merges them on GitHub once CI is green. The orchestrator lists the green ones for them at each gardening pass. Sessions never merge PRs.

## Branches, merging and pushing

- Feature work happens on `feat/F-0NN-<slug>` (a git worktree per builder in orchestrated runs) or directly on `main` in single-session runs.
- **Merging** into `main` takes three things:
  1. local `scripts/verify.sh` green on the branch;
  2. a reviewer `PASS` (given `SECURITY` when the feature has `reviews: ["security"]`, plus a `security-reviewer` `PASS` on the deep-security cards; spikes and small CI fixes are checked by the orchestrator instead, `PROMPT.orchestrate.md`);
  3. a fresh `scripts/verify.sh` on `main` after the merge (`git merge --no-ff`); its heavy checks are reused when the merged code tree is one that already passed;
  4. for a card that must pass on all three OSes, a green `workflow_dispatch` run of `ci.yml` on the branch before the merge.
- **Lockfiles** (`Cargo.lock`, `ui/pnpm-lock.yaml`) are never hand-merged. On a conflict, take `main`'s version and regenerate (`scripts/merge_lockfiles.sh`), then verify.
- **Pushing** `main` is allowed only when the session runs with `LECTER_ALLOW_PUSH=1`. After each push, check the run:
  - Find the run for the pushed commit: `gh run list --workflow ci.yml --branch main --commit <sha> --json databaseId,status,conclusion`.
  - Before the next merge, it must be green or still running.
  - If it is red: `gh run view <id> --log-failed | tail -n 80`, then fix it first (rule 2).
- **Syncing:** before pushing, run `git pull --no-rebase origin main`. The maintainer merges Dependabot PRs on GitHub, so `origin` can be ahead.
- Force pushes, history rewrites, tags and releases are never done by sessions (the guard hook enforces this).

## Versions and changelog

- **Version numbers:** SemVer `0.MINOR.PATCH` during v0. Finishing a milestone is a minor version (M1 → `v0.1.0`, M2 → `v0.2.0`, …); the walking skeleton (M0.5) is `v0.0.1`. The version lives in the root `Cargo.toml` workspace, `app/tauri.conf.json` and `ui/package.json`, and must match (checked in the `lint` stage).
- **`CHANGELOG.md`:** Keep a Changelog format. Every merged feature adds one user-facing line under `## [Unreleased]`. At release, the maintainer (or a session they ask) moves those lines under the new version heading.

## Adding to CI

New tests are picked up automatically by location (`docs/TESTING.md`). The workflow files only change when adding a new stage or job:

1. Add the stage to `scripts/verify.sh` first.
2. Then add the job.
3. Write a D-entry naming the job and whether it is required.
