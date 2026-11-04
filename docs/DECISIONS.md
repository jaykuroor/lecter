# Decisions

Choices made outside or on top of the spec. The spec wins over this file; this file wins over the code. Format and rules: `.claude/skills/handoff/SKILL.md`. Never delete an entry; supersede it.

## D-001 · Tauri 2 with a Rust core
2026-10-23 · maintainer · active
- Decision: Desktop shell is Tauri 2 using the system webview; all heavy work in a Rust core (tokio).
- Why: Smallest memory and install size of the cross-platform options while keeping a web UI; Rust for latency and safety.
- Instead of: Electron (memory), native per-OS UIs (3× the work), Flutter.

## D-002 · Local-first, no Lecter server in v0
2026-10-23 · maintainer · active
- Decision: Everything runs on the user's machine; users connect their own AI providers. No accounts, no telemetry.
- Why: Privacy, zero running cost, simplest security story. Cloud sync and hosted models are later (`15-later.md`).

## D-003 · MIT licence and a permissive-only dependency policy
2026-10-23 · maintainer · active
- Decision: Lecter is MIT. Dependencies only MIT, Apache-2.0, BSD, ISC, Zlib, MPL-2.0 (and similar); enforced by cargo-deny.
- Why: Open source like opencode, with room for paid services later. Excludes AGPL MuPDF, hence PDFium.

## D-004 · Open source now, optional paid services later
2026-10-23 · maintainer · active
- Decision: Build v0 with no billing code; keep a provider slot so a hosted "Lecter" provider can be added later.
- Revisit if: a paid plan is introduced.

## D-005 · SolidJS + TypeScript + Vite for the UI
2026-10-23 · Claude (planning) · active
- Decision: SolidJS for fine-grained updates without a virtual DOM; CodeMirror 6 owns the lecture surface.
- Why: Keystroke-to-paint budget (p99 < 8 ms) and small bundle.
- Instead of: React (heavier re-renders), Svelte (fine too; Solid's explicit signals fit streaming tokens better).
- Revisit if: the F-001 spike misses the budget for reasons Solid causes.

## D-006 · CodeMirror 6 with @replit/codemirror-vim as the lecture surface
2026-10-23 · Claude (planning) · active
- Decision: One buffer per lecture; slides, glosses, figures and keycaps are widgets and decorations.
- Why: Mature Vim emulation, virtualised rendering, decorations API fits anchored glosses. Confirmed or rejected by F-001.

## D-007 · Lecture files are Pandoc Markdown with fenced divs and attributes
2026-10-23 · maintainer + Claude · active
- Decision: Format exactly as `03-lecture-files.md`: readable without Lecter, anchors by block id.

## D-008 · Settings are JSONC with a JSON Schema generated from Rust types
2026-10-23 · Claude (planning) · active
- Decision: `schemars` generates `settings.schema.json`; Settings window, `:set` and files all go through it.
- Why: One source of truth for validation, completion and the settings UI.

## D-009 · Image understanding uses the provider by default; local model is opt-in
2026-10-24 · maintainer · active
- Decision: `parsing.vision = provider` by default; `local` (PaddleOCR-VL class, CPU-capable) and `auto` are options; text-layer slides need neither.
- Why: don't assume 16 GB RAM or a GPU; providers' vision is strong and cheap with a fast model.
- Revisit if: F-002 shows the local model wins on quality per cost on typical laptops.

## D-010 · Web search uses the provider's native tool by default, configurable at four levels
2026-10-24 · maintainer · active
- Decision: Modes `native | service | off`; precedence prompt > role (gloss type) > course > global; AI harness settings page exposes all of it.
- Why: results should be as close as possible to chatgpt.com and claude.ai; native tools are what those products use.

## D-011 · Local small embeddings by default; provider embeddings allowed if stored
2026-10-24 · maintainer · active
- Decision: `index.embeddings = local-small` by default; `provider` allowed (vectors stored locally, never recomputed per query). Final default chosen by the F-003 eval.

## D-012 · No graph RAG in v0
2026-10-23 · Claude (research) · active
- Decision: Hybrid BM25 + vectors with RRF, plus tools; concept map built from section trees without extra LLM calls.
- Why: Graph RAG costs thousands of indexing calls and 37–70 s per query on course material; it wins only on broad thematic questions.
- Revisit if: revise and gap-finder quality is poor in the AI eval.

## D-013 · Feedback sharing: ratings and metadata opt-in; text is a second opt-in
2026-10-24 · default applied (maintainer did not object) · active
- Decision: Both off unless chosen in onboarding; stored locally until `feedback.endpoint` exists.

## D-014 · Global config folder is ~/.config/lecter
2026-10-24 · maintainer · active
- Decision: `~/.config/lecter` (or `$XDG_CONFIG_HOME/lecter`) on Linux/macOS; `%APPDATA%\lecter` on Windows.
- Why: XDG convention: folders inside `~/.config` don't start with a dot.

## D-015 · Figures: described charts Auto, HTML pages Ask
2026-10-24 · default applied · active
- Decision: `figures.mode.described = auto`, `figures.mode.page = ask` with time and token estimate on the card.

## D-016 · Model-written context lines for chunks are off by default
2026-10-24 · default applied · active
- Decision: `index.contextLines = off`; chunks carry source, section path and page instead (free).
- Why: Saves an LLM call per chunk; can be enabled per course.

## D-017 · No Anthropic subscription sign-in
2026-10-24 · Claude (research) · active
- Decision: Anthropic via API key only; subscription sign-in only for providers whose terms allow third-party apps (`07-providers.md#sign-in`). Each method behind a build-time flag.
- Why: Anthropic's Feb 2026 terms bar consumer-subscription OAuth in third-party apps.

## D-018 · Biome for TypeScript lint and format
2026-10-24 · Claude (kit) · active
- Decision: Biome replaces ESLint + Prettier.
- Why: One fast tool, one config; the edit hook formats with it.

## D-019 · pnpm and the current Node LTS; Rust stable, edition 2024
2026-10-24 · Claude (kit) · active
- Decision: Exact versions are pinned by F-010 in `rust-toolchain.toml` and `packageManager`, and recorded in a new D-entry.

## D-020 · Crate names are lecter-<folder>
2026-10-24 · Claude (kit) · active

## D-021 · M0 spikes live in spikes/ and are not shipped
2026-10-24 · Claude (kit) · active
- Decision: Each spike is a folder with README and reproducible script; results become D-entries. Not in the spec layout on purpose.
- Updated 2026-10-24 (kit rebuild): cross-OS spikes (F-005 sandboxes, F-006 PDFium, F-027 IME, F-028 figure frame) measure on all three OSes through a `workflow_dispatch` CI matrix; live spikes call providers only through `scripts/live.sh` (D-046).

## D-022 · Budgets added by the kit beyond 14-quality.md
2026-10-24 · Claude (kit) · active
- Decision: UI main chunk ≤ 250 KB gzipped; a numeric step check ≤ 5 ms per pair; the local-model worker must run CPU-only on 8 GB RAM.
- Why: Keep cold start and keystroke budgets reachable; honour "no GPU assumed".

## D-023 · Build process: spec-driven, one feature per fresh session
2026-10-24 · Claude (kit) · active
- Decision: Sessions follow PROMPT.md; features.json changes only through scripts/feature.py; spec edits only in planning sessions; hooks enforce it.
- Why: Fresh context per feature keeps quality high and tokens low; files carry memory between sessions.

## D-024 · Default models are picked at connect time from the catalog
2026-10-24 · maintainer + Claude · active
- Decision: default-fast is the provider's fast tier (Gemini Flash, Claude Haiku, OpenAI's GPT Luna line, e.g. `gpt-6-luna` / `gpt-5.6-luna`), default-strong a Sonnet-class model or equal; the user can change both. No model ids hard-coded beyond catalog fallbacks.
- Why: fast models by default; model names change faster than releases.

## D-025 · Repository is github.com/jaykuroor/lecter (public), trunk on main
2026-10-24 · maintainer · active
- Decision: Public from day one (free CI on all three OSes). Default branch `main`; sessions push `main` after every verified feature; feature branches `feat/F-0NN-<slug>` merged with `--no-ff`; sessions push `main` only with `LECTER_ALLOW_PUSH=1`; never tag or force-push.

## D-026 · CI/CD as in 16-ci-cd.md
2026-10-24 · Claude (kit) · active
- Decision: ci.yml (lint, test on ubuntu-24.04/macos-15/windows-2025, e2e; perf from F-126), nightly.yml (full, fuzz, tauri-e2e, chaos, soak), release.yml on tags (tauri-action, signing optional, SBOM, draft release), dependabot weekly. `scripts/verify.sh --stage` is the only entry point.
- Why: maintainers build on Linux; CI is the only place macOS and Windows are exercised, and it stops one session from breaking another's work.
- Instead of: Separate CI logic in YAML (drifts from local checks); PR-per-feature with required checks (serialises builds behind 3-OS CI).
- Updated 2026-10-24 (kit rebuild): perf runs from the walking skeleton (F-025, D-044); ci.yml adds `e2e-app` (real app on 3 OSes) and `release-check`; nightly adds the perf matrix on 3 OSes; the lint stage adds the kit lints and gitleaks (16-ci-cd.md).

## D-027 · Orchestrated parallel builds
2026-10-24 · Claude (kit) · active
- Decision: An interactive orchestrator session (PROMPT.orchestrate.md) runs up to N background `builder` subagents, each in its own git worktree; it alone reviews, merges and writes shared state (PROGRESS, DECISIONS, QUESTIONS, CHANGELOG, README, features.json). The guard blocks shared-state edits inside worktrees.
- Why: many agents work while the maintainer watches and answers questions in the Claude Code CLI; a single writer avoids merge conflicts on state files.
- Updated 2026-10-24 (kit rebuild): default N is 1 and a second builder needs non-overlapping owned paths (D-040, D-051); builders set up with `scripts/worktree_setup.sh`; a security reviewer joins the reviewer (D-039); the orchestrator stops at milestone gates (D-038).

## D-028 · Test tooling
2026-10-24 · Claude (kit) · superseded in part by D-049 (real-app e2e)
- Decision: cargo-nextest, proptest, insta (snapshots), criterion, cargo-fuzz; Vitest + @solidjs/testing-library; Playwright (chromium + webkit) against a mocked core; WebdriverIO + tauri-driver nightly; `tests/fake-provider` is a workspace crate `lecter-fake-provider` (library + binary). Conventions in docs/TESTING.md.

## D-029 · Version, changelog and dev entry points
2026-10-24 · Claude (kit) · active
- Decision: One version in Cargo `[workspace.package]`, `app/tauri.conf.json` and `ui/package.json` (checked by verify); Keep a Changelog with one line per merged feature; `scripts/dev.sh` runs the app in dev mode; `README.md` is the public face and its Roadmap status is updated when a milestone completes.

## D-030 · App identifier io.github.jaykuroor.lecter, built to be renamed
2026-10-24 · maintainer · active
- Decision: Use `io.github.jaykuroor.lecter` until the project owns a domain. Nothing durable depends on it: paths and keychain use the fixed name `lecter`, the webview stores nothing durable, Windows keeps a fixed WiX upgradeCode, and `identity::migrate()` handles `LEGACY_APP_IDS` (01-architecture.md#app-identity-and-migration).
- Why: a real domain-based id may come later, without breaking users' data or updates. `io.github.<user>.<app>` is also an accepted Flathub id pattern, so a rename may never be needed.

## D-031 · Live AI testing uses Gemini (API key) and OpenAI (ChatGPT sign-in)
2026-10-24 · maintainer · active
- Decision: Live spikes and the AI eval use Gemini via `GEMINI_API_KEY`, and OpenAI through the app's own ChatGPT sign-in once F-055 exists (F-070 re-runs the comparisons). Anthropic and other adapters are tested only against the fake provider until the maintainer adds a key.
- Consequence: features marked `needs: ["live-keys"]` run only with `LECTER_LIVE_TESTS=1`.
- Updated 2026-10-24 (kit rebuild): keys live in `~/.config/lecter-dev/keys.env` and reach only commands run through `scripts/live.sh` (D-046), never the session environment. The ChatGPT sign-in is F-085; F-111 re-runs the comparisons. Gemini is the free tier (D-035).

## D-032 · The maintainer's lecture files are a private, local-only test corpus
2026-10-24 · maintainer · active
- Decision: 25 real files (slides with and without annotations, dense text, fully handwritten notes) live in `tests/corpus/private/` with a manifest (ids P-01…P-25, kind guesses from text-layer stats). Confidential: never committed, bundled, quoted or named in tracked files. Enforced by .gitignore (all documents ignored outside fixtures/public corpus), scripts/check_private.py and the guard hook.

## D-033 · The tutorial teaches the app with synthetic English content
2026-10-24 · maintainer · active
- Decision: "Lecter 101" sample course, one plain-English lecture about using Lecter, canned "Sample answer" glosses, works offline with no provider. No statistics demo, no real course material.

## D-034 · Two parallel builders by default
2026-10-24 · maintainer · superseded by D-040
- Decision: `LECTER_PARALLEL=2` (a 32 GB RAM machine, Claude Pro). Builders run as background subagents that the maintainer watches from the agent panel; agent teams (experimental, no resume, no worktree isolation) are not used.

## D-035 · Free-tier Gemini may receive slides; nothing is published
2026-10-24 · maintainer · active
- Decision: Live spikes and the AI eval may send the maintainer's private slides to their own free-tier Gemini key. Nothing from them is ever published or made public; the private-corpus rules (D-032) are unchanged.
- Consequence: live scripts rate-limit themselves (Gemini free-tier preset in `scripts/live.sh`: 8 requests/min, 200/day, 200k tokens/min by default), honour `retry-after`, back off with jitter, and save partial results (SEC-15). The app ships the same preset (SEC-10).

## D-036 · The concept demo becomes docs/design
2026-10-24 · maintainer · active
- Decision: The look and interaction patterns of `lecter-concept-demo.html` become `docs/design/` (`tokens.json`, `components.md`, `reference/` crops). The demo palette is the bundled default "Lecter" theme and the fallback; GTK themes still win on Linux. None of the demo's course content is used; committed crops were sanitised.
- Consequence: UI features attach screenshots that the reviewer compares with the reference crops; per-OS baselines come with F-177 and only the maintainer approves baseline changes.

## D-037 · Local build inside the Claude Code sandbox
2026-10-24 · maintainer · active
- Decision: The maintainer runs `claude` in the repo on their own Linux machine (no container or VM). `.claude/settings.json` turns on Claude Code's sandbox (bubblewrap + socat) with `failIfUnavailable`, a network allowlist (crates, npm, GitHub, Playwright, rustup), no unsandboxed retries, and denied reads of SSH, GPG, AWS, the second account's config and the live keys.
- Why: Agents run for hours with permission prompts mostly pre-approved; the sandbox bounds what a mistaken or injected command can reach.
- Revisit if: the dry run on the maintainer's machine finds a blocked essential step: narrow the allowlist (never disable the sandbox) and record a D-entry.

## D-038 · Milestone gates pause the build for the maintainer
2026-10-24 · maintainer · active
- Decision: When a milestone's non-spike features are all done, `next.py` exits 5 and the orchestrator stops dispatching. It runs the security reviewer on the milestone, shows the maintainer a 5–10 minute checklist for `scripts/dev.sh` (`feature.py gate`, from each feature's `try` line), and waits. The maintainer's notes go to QUESTIONS → planning session → features. `feature.py gate M<n> --pass` records his go.

## D-039 · A security reviewer and the robustness basics
2026-10-24 · maintainer · active
- Decision: `.claude/agents/security-reviewer.md` reviews every feature with `reviews: ["security"]` (parse worker, IPC or capabilities, keys, network, figure iframe, file writes, updater; 44 features) and each milestone, against a fixed checklist mapped to SEC-xx (13-security.md) and ROB-xx (17-robustness.md). Those specs now cover outbound rate limiting, spend caps, coalescing, timeouts, input limits, file watching, external edits, data versioning, file-system edge cases, secrets, logs, output handling, Tauri lockdown, processes, supply chain and provider drift.
- Why: these are what vibe-coded apps usually leave out (OWASP Top 10 for LLM Applications 2025, Tauri's capability model).

## D-040 · Quality over speed: one builder at a time
2026-10-24 · maintainer · active
- Decision: `LECTER_PARALLEL` defaults to 1. The maintainer may opt into 2 only for features with non-overlapping owned paths (`next.py --ready --beside`). The orchestrator writes a resume point to PROGRESS before every dispatch and merge and recovers builders that died mid-step (stash, then resume the branch).
- Why: usage windows are the bottleneck; a second builder spends them twice as fast and adds merge conflicts.
- Instead of: D-034 (two builders by default).

## D-041 · Dependency approval policy
2026-10-24 · maintainer · active
- Decision: Agents may add small pure-Rust or JS packages within the licence policy, with a `Dep-Added` trailer and a D-entry. Native code (ONNX Runtime, PDFium builds, C/C++ build scripts, system libraries), more than 30 new crates, or more than 100 KB gzipped to the UI need the maintainer first (`NEEDS_MAINTAINER`, then a `Deps-Approved: D-0NN` trailer). Single source: `01-architecture.md#dependency-policy`; enforced by `scripts/add_dep.py`, `scripts/check_deps.py` and the guard.

## D-042 · macOS is verified only in CI until the maintainer has a Mac
2026-10-24 · maintainer · active
- Decision: macOS builds and real-app e2e run in CI (macos-15). A hands-on Mac checklist (Q-004) runs before the first public release.

## D-043 · Walking skeleton (M0.5) before any polish
2026-10-24 · Claude (kit) · active
- Decision: Milestone M0.5 builds one thin path through every layer on all three OSes: open a course, parse one text PDF in the worker, edit it with Vim keys, save and survive a restart, BM25 search, one gloss from the fake provider, one described figure (F-015 to F-028). M1 shell polish comes after it; later features extend the skeleton, never fork it.
- Why: integration risk is found in week one, not month three; the research rubric's criterion 3.

## D-044 · Perf harness ships with the skeleton
2026-10-24 · Claude (kit) · active
- Decision: F-025 builds `tests/perf/budgets.sh` with keystroke-to-paint, cold open, idle RAM, 300-slide RAM, idle CPU, TTFT overhead and UI bundle budgets. From then on the default verify runs the quick set and CI runs all of them; nightly runs them on three OSes. Installer-size budgets join with packaging.
- Why: budgets were CI gates in the spec but their harness came in the last milestone (review bug 2).

## D-045 · Narrow command allowlist; sandbox decides nothing on its own
2026-10-24 · Claude (kit) · active
- Decision: `autoAllowBashIfSandboxed: false`, so every command still needs an allow rule. Rules are the exact forms the kit uses (`pnpm -C ui run|exec|install`, `cargo build|test|clippy|…`, `cargo run -p lecter-*`, read-only git and shell). No bare `node`, `npx`, `npm`, `find`, `cp`, `mv`, `timeout` or `cargo *`. Denied: dependency adds (`cargo add`, `pnpm add`), `find -delete`, force pushes, history rewrites, tags, `sudo`, PR merges, releases. `scripts/live.sh` is an ask rule and an excluded command (it runs outside the sandbox so it can read the keys file and reach the provider).
- Why: research criterion 10; the sandbox limits damage, the allowlist limits intent.

## D-046 · Live keys reach only scripts/live.sh
2026-10-24 · Claude (kit) · active
- Decision: Keys live in `~/.config/lecter-dev/keys.env` (mode 600). `scripts/live.sh F-0NN -- <cmd>` loads them into that one command, only for an in-progress feature with `needs: ["live-keys"]`, logs what ran, and the maintainer approves each run. The sandbox denies the file and the key variables to every other command; the guard and permission rules block reading it; SessionStart warns if a key is in the session environment.
- Why: the old guide exported keys before `claude`, so every builder inherited live mode (review bug 3).

## D-047 · Protected checks, the test-weakening lint and the IMPOSSIBLE outcome
2026-10-24 · Claude (kit) · active
- Decision: The guard blocks edits (and shell writes) to existing checks: verify.sh, budgets, thresholds, workflows, lint configs, snapshots and baselines, unless the in-progress feature lists the file under `protected`. `scripts/check_tests.py` fails a change that deletes or skips tests, adds retries, loosens budgets or thresholds, or changes snapshots, unless a `Test-Removed`, `Snapshot-Changed` or `Budget-Changed` (with the maintainer's D-entry) trailer explains it. A builder that can't meet a criterion reports `IMPOSSIBLE` with evidence.
- Why: research criterion 11; agents game checks they can edit, and an explicit way out cuts gaming sharply.

## D-048 · IPC contract generated with tauri-specta
2026-10-24 · Claude (kit) · active
- Decision: Commands and events are Rust types exported with tauri-specta (v2, the Tauri 2 line) to `ui/src/core/bindings.ts`; the mocked core implements the same types; `verify.sh` fails on stale bindings (F-017 pins the version in a D-entry). Spec: `18-contracts.md` (IPC, validation, error codes, worker protocol, `state.db` v1, journal format).
- Instead of: ts-rs plus hand-written invoke wrappers (two sources of truth), TauRPC (smaller community).

## D-049 · Real-app e2e with the embedded WebDriver plugin
2026-10-24 · Claude (kit) · active; partly superseded by D-094
- Decision: Debug builds embed `tauri-plugin-wdio-webdriver`, and WebdriverIO drives the real app on Linux, Windows and macOS (`tauri-driver` can't drive macOS). Native dialogs are answered by debug-only `LECTER_TEST_PICK` / `LECTER_TEST_TRUST`. `lecter-harness` exposes the core as JSON for GUI-free checks. Playwright on the mocked core stays the fast loop. `release-check` proves release binaries contain none of it.
- Instead of: D-028's nightly-only tauri-driver.

## D-050 · Evidence files per feature
2026-10-24 · Claude (kit) · active
- Decision: Each feature lists evidence (`screenshot:`, `log:`, `harness:`, `perf`); builders save it to `.evidence/<F-id>/` (git-ignored) with the `drive-app` skill; `feature.py done` runs `evidence.py check`; reviewers open it and compare screenshots with `docs/design/reference/`.

## D-051 · Owned paths per feature; lockfiles regenerated
2026-10-24 · Claude (kit) · active
- Decision: Every feature has `paths` globs. `next.py --ready --beside` lists only features that overlap no running one (lockfiles, CHANGELOG, docs and CLAUDE.md files are shared). Lockfile conflicts are resolved by `scripts/merge_lockfiles.sh` on `main`, never by hand.

## D-052 · Private corpus: exact ignore rule and text fingerprints
2026-10-24 · Claude (kit) · active
- Decision: `.gitignore` ignores `tests/corpus/private` without a trailing slash, so the builder's symlink is ignored too. `scripts/check_private.py` flags tracked private paths, symlinks into the folder, byte copies, file names, and any tracked text sharing a run of 160+ normalised characters with a private file (winnowed 48-character fingerprints).
- Why: review bugs 1 and 4.

## D-053 · Secret scanning with gitleaks
2026-10-24 · Claude (kit) · active
- Decision: `scripts/secret_scan.sh` (gitleaks; old and new CLIs) runs in the lint stage (commits since the base, staged, unstaged and untracked files) and in the Stop hook (this session's commits). CI scans the full history. Findings stop the push; the maintainer rotates the secret.

## D-054 · Mechanical architecture and code-health rules
2026-10-24 · Claude (kit) · active
- Decision: `scripts/check_arch.py` enforces the crate-edge table, workspace lints (`unwrap_used`, `expect_used` denied) and `clippy.toml` disallowed blocking methods; `scripts/check_size.py` caps source files at 500 lines, spec files at 300 and AGENTS.md + CLAUDE.md at 150; jscpd and knip join the lint stage with F-014. The gardener runs every 6 features.

## D-055 · Native crates covered by the decided stack
2026-10-24 · Claude (kit) · active
- Decision: `scripts/deps_preapproved.txt` lists native crates that the stack decisions already imply (Tauri's webview bindings, bundled SQLite, ring, compression, D-Bus for the keychain), so `check_deps.py` doesn't stop for them. Anything else native needs the maintainer (D-041). The file is a kit file only the maintainer edits.

## D-056 · Builder discipline: baseline first, stuck rule
2026-10-24 · Claude (kit) · active
- Decision: A builder runs `verify.sh --quick` before building (via `worktree_setup.sh`) and reports BLOCKED instead of building on a red `main`. After two identical failures or about 30 minutes without progress it commits and reports BLOCKED with evidence.

## D-057 · Sandbox fixes from the kit dry run
2026-10-24 · Claude (kit) · active
- Decision: Changes from running the kit in a real sandboxed Claude Code session. `init.sh` creates the sandbox's write folders and, if it can't, prints the `mkdir -p` line to run outside, because the sandbox only grants writes to folders that already exist. `.gitignore` ignores the placeholders the sandbox mounts over root dotfiles and Claude Code's own `.claude/` folders (only `settings.json`, `agents/` and `skills/` are tracked there), because they break `git add -A` mid-session. The allowlist accepts each script both as `scripts/x.py` and as `python3 scripts/x.py`. `init.sh` and `verify.sh` point pnpm at `HTTPS_PROXY`, because pnpm prefers inherited `npm_config_*` proxy settings that the sandbox doesn't replace. `init.sh` passes `--silent` to pnpm rather than to the build script, installs Playwright's Chromium (unless `PLAYWRIGHT_BROWSERS_PATH` is set), and `verify.sh` runs biome with `--colors=off` so failure lines stay readable.

## D-058 · Toolchain pins: Rust 1.99.1, Node 24.18.0, pnpm 12.15.0
2026-10-23 · maintainer (Node) + session F-010 · active; Node pin superseded by D-130 (24.22.1)
- Decision: `rust-toolchain.toml` pins `channel = "1.99.1"` (current stable, with rustfmt and clippy, minimal profile). Node is pinned to the 24 LTS line, exactly 24.18.0 (the version the build machine's `nodejs24` package ships, so local runs match CI), and pnpm to 12.15.0. F-011 writes them into `ui/package.json` (`packageManager: "pnpm@12.15.0"`, `engines.node`) and F-013 into CI. The maintainer chose Node 24 over the installed 22.23.1.
- Why: Exact pins make local runs, CI and every session build the same way (D-019). Node 24 is the active LTS line, and 22 is in maintenance.
- Instead of: `channel = "stable"` (it moves under us); Node 22.23.1 (installed on the maintainer's machine, but older LTS).
- Revisit if: a new Rust stable fixes something we need, or Node 26 enters active LTS.

## D-059 · Blocking fs in async code is a review rule
2026-10-23 · session F-010 · superseded by D-075
- Decision: `clippy.toml` disallows only `std::thread::sleep`. Blocking `std::fs` calls stay allowed, because the parse and model workers and `spawn_blocking` bodies need them; reviewers reject them on an async runtime thread.
- Why: Clippy's `disallowed-methods` can't tell async code from sync code, so banning `std::fs` would put an `#[allow]` on every legitimate call.
- Instead of: banning `std::fs::*` with per-call-site allows.
- Revisit if: a clippy lint for blocking calls in async contexts becomes available.

## D-060 · `lecter` v0 prints `lecter <version>` for any arguments
2026-10-23 · session F-010 · active
- Decision: The v0 `lecter` binary prints exactly `lecter 0.0.1\n` on stdout, nothing on stderr, and exits 0 whatever its arguments. Every crate has a smoke test asserting its package name (`lecter-<folder>`) and that its version is SemVer `x.y.z`. Repo-shape tests (members, version, toolchain, deny.toml, .gitattributes) live in `crates/harness/tests/workspace.rs`. `deny.toml` spells "Unicode" in the policy as SPDX `Unicode-3.0` and `Unicode-DFS-2016`, and turns off warnings for allowed licences nothing uses yet.
- Why: This is the conventional `--version` shape. Ignoring arguments keeps the stub free of v1 command parsing. The harness is the workspace's test crate.
- Instead of: printing only `0.0.1`; adding a `toml` dev-dependency for the shape tests (std string parsing is enough).

## D-061 · Use `node-24` explicitly; system `node` stays on 22
2026-10-23 · maintainer · superseded by D-130
- Decision: the maintainer's system `node` keeps pointing at 22.23.1. Sessions run the UI toolchain on Node 24.18.0 through `/usr/bin/node-24` (for example a `node` link to it at the front of `PATH` for pnpm commands), without changing the system `node`.
- Why: the maintainer asked to use `node-24` and leave `node` alone.
- Instead of: repointing the system `node` at 24.
- Revisit if: the build machine's default `node` becomes 24.

## D-062 · Hand-written IPC contract until generated bindings
2026-10-24 · session F-011 · active
- Decision: `ui/src/core/commands.ts` declares the `Commands` map (only `app_info`) and `IpcError` by hand. F-017 replaces it with the generated `bindings.ts`.
- Why: the mocked core needs a typed contract now.
- Instead of: inventing more commands ahead of the spec.

## D-063 · The mocked core replaces `__TAURI_INTERNALS__`
2026-10-24 · session F-011 · active
- Decision: `installMockCore()` stands in for Tauri IPC. Playwright installs it with `addInitScript`; `pnpm run dev` in a plain browser installs it itself (dev builds only; production drops it).
- Why: one mock serves e2e tests and browser dev.
- Instead of: `@tauri-apps/api/mocks`, which can't be serialised into `addInitScript`.

## D-064 · Playwright port derived from the checkout path
2026-10-24 · session F-011 · active
- Decision: the e2e dev server port is a hash of the checkout path (`LECTER_E2E_PORT` overrides), with `reuseExistingServer: false`. Projects: `smoke` (Chromium, `@smoke`), `chromium`, `webkit`; `test:e2e` runs chromium and webkit (D-028).
- Why: parallel worktrees must not serve each other's code.
- Instead of: a fixed port.

## D-065 · jsdom for Vitest; shell colours are tokens only
2026-10-24 · session F-011 · active
- Decision: Vitest uses jsdom. Shell CSS uses token variables only (`--window-bg` etc.), left undefined until F-042 defines them.
- Why: happy-dom has had RCE advisories; no hard-coded colours (AGENTS.md).
- Instead of: happy-dom; placeholder colour values.

## D-066 · UI dependencies added (F-011)
2026-10-24 · session F-011 · active
- Decision: Runtime: solid-js 1.9, @tauri-apps/api 2.12 (whole app bundle 5.4 KB gz). Dev: typescript 7.0, vite 8.3, vite-plugin-solid, @biomejs/biome 2.6, vitest 5.0, jsdom, @solidjs/testing-library, @playwright/test 1.64, jscpd, knip, @types/node. All MIT, Apache-2.0 or ISC; added through add_dep.py (Dep-Added trailers on the branch).
- Why: the stack in 01-architecture.md#stack-decided and the checks verify.sh calls.

## D-067 · Tauri 2 crate tree approved, with the LLVM-exception licence
2026-10-24 · maintainer · active
- Decision: the maintainer approves adding `tauri` 2 (about 381 crates, including the native build crates embed-resource, iana-time-zone-haiku, system-deps and vswhom-sys) to `lecter-app`, plus `tauri-build` 2 as its build dependency. This is an exception to the 30-crate limit (D-041). The maintainer also allows the licence `Apache-2.0 WITH LLVM-exception` (target-lexicon), so F-012 may add it to `deny.toml`'s allow list. Since `add_dep.py` has no build-dependency flag, F-012 may add `tauri-build` to `[build-dependencies]` by hand, with a `Dep-Added` trailer. F-012 may also add `"app"` to the root `Cargo.toml` members.
- Why: D-001 picks Tauri 2, and the app shell, and everything in M0 that needs it, depends on this. The LLVM exception only makes Apache-2.0 more permissive.
- Instead of: blocking F-012.
- Revisit if: Tauri's tree grows a copyleft licence or the crate count roughly doubles.

## D-068 · Dev runs without the Tauri CLI
2026-10-24 · session F-012 · active
- Decision: `scripts/dev.sh` starts Vite on 127.0.0.1:5173 (`--strictPort`), waits until it answers (exits 1 after 30 s if it never does), then runs `cargo run -p lecter-app`. Debug builds load devUrl and need no `ui/dist`.
- Why: no extra native npm CLI. Node may bind `localhost` to IPv6 only.
- Instead of: `@tauri-apps/cli`; `localhost`.

## D-069 · Release builds must embed the UI
2026-10-24 · session F-012 · active
- Decision: `lecter-app` has a `custom-protocol` feature (`tauri/custom-protocol`), not on by default. `main.rs` has `compile_error!` under `cfg(all(dev, not(debug_assertions)))`, so a release build without it fails. Release and packaging builds pass `--features custom-protocol`. A test pins this.
- Why: without it, a release build loads devUrl with devCsp, and any local process on port 5173 would get the window's IPC grants (security review, SEC-30/31/34).
- Instead of: `default = ["custom-protocol"]` with `--no-default-features` in dev.sh.

## D-070 · Least-privilege IPC and dev CSP
2026-10-24 · session F-012 · active
- Decision: an AppManifest built from `app/src/ipc/names.rs` makes one `allow-<cmd>` permission per command. `capabilities/main.json` grants only `allow-app-info`, with no `core:default`. `devCsp` is SEC-30 plus `ws://127.0.0.1:5173` for hot reload, and a test pins that this is the only difference. `freezePrototype` is on and `withGlobalTauri` is off. `app_info` returns `{name, version}` from package_info.
- Why: SEC-31 least privilege; the UI already calls `app_info`.
- Instead of: app commands open to every window; no devCsp.

## D-071 · APP_ID from tauri.conf.json, with no second copy
2026-10-24 · session F-012 · active
- Decision: `crates/core/build.rs` reads `identifier` from `app/tauri.conf.json` with a small string parser into `identity::APP_ID`. Tests read the expected identifier from `docs/spec/01-architecture.md` and scan every tracked file outside `docs/` for other copies. `app/gen/` and `app/permissions/autogenerated/` are git-ignored. Icons come from a stdlib-only `app/icons/make_icons.py` using the accent tokens. Dependencies: tauri 2 and tauri-build 2 (D-067), serde and serde_json (dev), which add no new crates.
- Why: the spec says only tauri.conf.json spells out the identifier.
- Instead of: serde_json as a build dependency; a literal in the tests with an exemption.

## D-072 · CI layout: shared setup action, rustup and pinned gitleaks
2026-10-24 · session F-013 · active
- Decision: all jobs share `.github/actions/setup/action.yml`. Rust comes from rustup at the channel in rust-toolchain.toml, with no toolchain action. gitleaks 8.30.1 is installed by `.github/scripts/install-gitleaks.sh` with SHA-256s for linux_x64, darwin_arm64 and windows_x64. Third-party actions are pinned by full SHA: checkout v7.0.1, setup-node v7.1.0, pnpm/action-setup v6.1.0, rust-cache v2.9.3, install-action v2.87.31, upload-artifact v7.0.2.
- Why: one copy of the setup steps; fewer third-party actions.
- Instead of: inline steps per job; a gitleaks action; a Rust toolchain action.

## D-073 · Concurrency written in block style
2026-10-24 · session F-013 · active
- Decision: `ci.yml` writes the 16-ci-cd.md concurrency group and cancel rule as a YAML block.
- Why: the spec's one-line flow form, with `${{` inside `{ }`, isn't valid YAML.
- Instead of: the literal line from the spec.

## D-074 · init and verify set up their own environment
2026-10-24 · session F-013 · active
- Decision: `init.sh` and `verify.sh` each carry the same inline environment block. It sets the pnpm proxy and falls back to `/usr/bin/node-24` when `node` isn't the pinned version (`LECTER_NODE_FALLBACK` overrides it). The node link lives in a user-owned, mode-700 dir (`~/.cache/lecter/…`, else `$TMPDIR`, never bare /tmp) and is re-pointed if wrong. The block moves XDG_RUNTIME_DIR to TMPDIR when it isn't writable, and points `pnpm_config_store_dir` at the home store when pnpm's store would fall inside the checkout. verify.sh checks `[ -e .git ]`, so worktrees run every lint. `init.sh --check` prints an install hint for each missing tool.
- Why: sessions kept setting these up by hand (D-061). A shared sourced file would let a builder change what protected checks run, since only verify.sh is protected (review of F-013).
- Instead of: a shared `scripts/lib_env.sh`; a link in shared /tmp.

## D-075 · Blocking calls banned in async crates (supersedes D-059)
2026-10-24 · session F-014 · active
- Decision: the root clippy.toml (core, index, ai, cas, cli, app, fake-provider) bans `std::thread::sleep`, 24 blocking `std::fs` calls, 12 `std::net` calls and the 5 Tauri `app_*_dir` helpers. `crates/{parse,models,harness}/clippy.toml` are identical copies without the fs/net bans, since parse/models are sync worker processes and harness is a sync CLI and test driver. Clippy uses the nearest config and doesn't merge it with the root one. Tests, build.rs and test modules allow the fs ban at the call site with a reason. A test pins the config set to exactly these four files and forbids `CLIPPY_CONF_DIR` in `.cargo/config*`. The guard protects `crates/*/clippy.toml` (the author, c53127d).
- Why: the spec bans these calls "in async crates" (criterion F-014.2); D-059 left them to reviewers.
- Instead of: D-059's review-only rule; banning everywhere with per-call allows.

## D-076 · Clippy fixture uses a stand-in tauri crate
2026-10-24 · session F-014 · active
- Decision: `tests/fixtures/lint/clippy/` (manifests named `Cargo.fixture.toml`, so cargo and check_deps ignore them) runs in a temp workspace with the real `[workspace.lints]`. The real Tauri paths are checked in lecter-app itself: clippy warns on an unresolvable disallowed path, which fails under `-D warnings`.
- Why: seconds per run instead of compiling Tauri in the test stage.
- Instead of: a workspace-member fixture.

## D-077 · jscpd and knip scope
2026-10-24 · session F-014 · active
- Decision: jscpd scans `ui/src`, `crates` and `app/src` (ts/tsx/rust), with `minLines` 30 and `exitCode` 1, ignoring the generated `bindings.ts` and `gen/`. `scripts/` isn't scanned, so the D-074 env blocks stay duplicated. knip has explicit entries and ignores `src/core/bindings.ts` until F-017 generates it.
- Why: criterion F-014.4.

## D-078 · CI installs only from the lockfiles
2026-10-24 · the author (at the M0 gate) + CI-4ec6f29 · active
- Decision: when `CI` is set, `scripts/init.sh` runs only `cargo fetch --locked`, `cargo build --workspace --locked` and `pnpm -C ui install --frozen-lockfile`. A mismatch prints which lockfile to update and exits 1. Local runs keep the unlocked fallback. `crates/harness/tests/init_install.rs` pins both cases with stubbed tools (unix only). The harness lint tests run Python with `PYTHONUTF8=1`, so kit scripts that print "→" work on Windows consoles.
- Why: M0 security review (SEC-50, Q-005). A PR with stale lockfiles had them rewritten in CI and went green.
- Instead of: leaving the fix to the planning session.

## D-079 · F-001 spike installs its own packages
2026-10-24 · Who: maintainer · active
- Decision: the editor spike keeps its own `spikes/editor/package.json` with exact pins (CodeMirror 6, @replit/codemirror-vim, KaTeX, Vite, @playwright/test; all MIT) and its own lockfile. The builder may run `pnpm -C spikes/editor install` and `pnpm -C spikes/editor exec playwright install webkit`. Nothing is added to `ui/` or `crates/`. If WebKit won't install or launch on the build machine, the spike records that and measures it later (CI on ubuntu, or the real app via F-016).
- Why: `add_dep.py` covers only `ui/` and Rust, and the spike can't measure anything without these packages.
- Instead of: adding the packages to `ui/`, or skipping the WebKit measurement.

## D-080 · CodeMirror 6 stays, with conditions (F-001 result)
2026-10-24 · Who: maintainer · active
- Decision: GO with conditions for the CodeMirror 6 lecture surface. Measured numbers are in the F-001 spike entry (`spikes/editor/README.md`). Chromium passes (novsync p99 4.8–5.2 ms). Headless WebKit 27.2 in a container misses the 8 ms keystroke budget end to end (work p99 11–12 ms across all four runs; the script says NO-GO every time). WebKit heap size couldn't be measured (Playwright exposes no heap API for WebKit, and `performance.memory` is Chromium-only), so the spike reports browser process-tree RSS (512–749 MB) instead. That isn't comparable with the app's idle_rss budget, and the WebKitGTK memory check moves to F-016. After the fixes, with the Markdown parse off the keystroke path, WebKit sync p99 is 7 ms (9 ms with it on). Conditions: KaTeX loads lazily. No Markdown parse on the keystroke path in the default preset (D-081). The real-app keystroke p99 on WebKitGTK (F-016 WebDriver trace) is the deciding check. If it is ≥ 8 ms, the stack is revisited before more editor work.
- Why: the remaining WebKit cost is CodeMirror core plus the Markdown parse. Headless, no GPU and 1 ms timers make the container a harsher test than the shipped app.
- Instead of: NO-GO and a new editor stack, or holding the decision until F-016.

## D-081 · Performance presets; Balanced is the default
2026-10-24 · Who: maintainer · active
- Decision: performance features that can change without breaking the app are user-configurable and default to **Balanced**. One preset setting in Settings > Performance and `:set` has three presets. **Performance:** no live Markdown highlighting or live math. **Balanced (default):** KaTeX loads lazily, and Markdown highlighting runs after a short pause in typing (idle-time parse, off the keystroke path). **Quality:** full live highlighting and math on every keystroke, with a visible note that it can add input lag on slower machines. Markdown highlighting is in v0 (Balanced form).
- Why: the F-001 spike profile (Chromium) puts the Markdown parse at about 0.85 ms/key. On WebKit, turning it off took sync p99 from 9 to 7 ms, under the 8 ms budget (D-080). Users on fast machines can opt into Quality.
- Instead of: dropping Markdown highlighting from v0, or a fixed per-keystroke parse.
- Spec: needs criteria in the settings features (F-030, F-045) and the editor surface. Q-006 asks the planning session to add them.

## D-082 · Spike crates are allowed in the workspace with no Lecter edges
2026-10-24 · Who: maintainer · active
- Decision: `scripts/check_arch.py` accepts any workspace crate named `lecter-spike-*` whose folder is under `spikes/`, and allows it no dependency on any Lecter crate. The author applies the kit change (the file is guard-protected). Spikes stay throwaway and outside the 01-architecture table until Q-007 adds a line about them.
- Why: F-005's criterion 1 requires a workspace test crate, so CI's `test` job runs it on macOS and Windows. Without this, verify is red on arch and the harness lint test.
- Instead of: excluding spikes from the workspace (breaks F-005 criteria 1 and 3), or adding each spike to the table.

## D-083 · Parse-worker OS sandboxes: GO on Linux and macOS; Windows short of SEC-01 (F-005 result)
2026-10-24 · F-005 spike · active
- Decision: the parse worker sandbox approach per OS, from `spikes/os-sandbox` (branch `feat/F-005-os-sandbox`, README). **Linux GO:** Landlock (up to ABI 10) + seccomp (no new processes, no sockets, io_uring or ptrace) + RLIMIT_AS, with inherited fds closed and the input opened before lockdown (11/11 locally and on ubuntu-24.04). **macOS GO:** Seatbelt deny-default + RLIMIT_AS at map size + 1 GiB, input pre-opened (macos-15, CI run 40154388308). **Windows:** LPAC AppContainer + job object, with the input passed as a handle. Network (Winsock refuses to start, 10107), user files, earlier inputs, 1 GiB, and no child processes all hold (CI run 40154388308, 55/56). But it can read files granted to ALL RESTRICTED APPLICATION PACKAGES (e.g. `C:\Windows\win.ini`), so SEC-01's "input only" isn't met (Q-008). A Chromium-style lockdown token (30934ba) failed to start (0xC0000135).
- Why: the spike's measured results (criterion 3). The README lists 10 carry-forward requirements for the real worker (fork/clone rule, closing fds, launch from one long-lived thread with a getppid check, private Windows handles, no std::net under LPAC, etc.).
- Instead of: crates landlock/seccompiler (raw libc), or a restricted token without AppContainer on Windows.
- Dep-Added: libc, windows-sys 0.61 (both already in Cargo.lock; spike crate only).

## D-084 · PDFium comes from bblanchon/pdfium-binaries, pinned by SHA-256
2026-10-24 · Who: maintainer · active
- Decision: Lecter's PDFium is the prebuilt release from github.com/bblanchon/pdfium-binaries at one fixed release tag. PDFium itself is BSD-3-Clause/Apache-2.0; the build scripts are MIT. The download script pins a SHA-256 for each of linux-x64, linux-arm64, macos-universal, windows-x64 and windows-arm64, and refuses any file that doesn't match before it is used (SEC-51).
- Why: it is the source pdfium-render documents. Prebuilt binaries for all five targets avoid a depot_tools/gn build per OS.
- Instead of: building PDFium from Google's source in CI.

## D-085 · pdfium-render approved as a dependency
2026-10-24 · Who: maintainer · active
- Decision: `pdfium-render` 0.9.4 (MIT OR Apache-2.0; 9 crates with default features off; features `thread_safe`, `pdfium_7881`) may be used to load PDFium dynamically. The F-006 branch commit's `Deps-Approved: D-084` trailer is covered by this entry. The maintainer approved the crate separately from the binary source (D-084).
- Why: criterion 2 of F-006 names it. It avoids hand-written FFI.
- Instead of: hand-written bindings.

## D-086 · Network allowed in the PDFium spike's tests until a CI cache exists
2026-10-24 · Who: maintainer · active
- Decision: an exception to "no real network in tests", for the `lecter-spike-pdfium` crate only. Its tests may download the pinned PDFium archives from bblanchon/pdfium-binaries GitHub releases (each SHA-256-checked before use, cached in `target/pdfium`). No other test may use the network. Before any shipping crate needs PDFium, a pinned CI cache/setup step keyed on `pins.json` replaces the downloads (Q-009).
- Why: F-006 criterion 2 needs PDFium on all three CI OSes, and a CI setup step needs a ci.yml change.
- Instead of: changing ci.yml now, or blocking F-006.

## D-087 · PDFium pinned and bundled (F-006 result): GO
2026-10-24 · F-006 spike · active
- Decision: GO on all three CI OSes (CI run 40161530691: ubuntu-24.04, macos-15, windows-2025 green). Source: bblanchon/pdfium-binaries tag `chromium/7881` (PDFium 151.0.7881.0, 2026-06-08), the tag matching pdfium-render 0.9.4's newest API feature `pdfium_7881`. Licence: PDFium BSD-3-Clause AND Apache-2.0, plus bundled third-party notices in `licenses/` (FreeType, ICU, libjpeg-turbo, OpenJPEG, libtiff, libpng, lcms, zlib, abseil, AGG, fast_float, simdutf, llvm-libc); build scripts MIT. Sizes (archive / library): linux-x64 3.6/7.6 MB, linux-arm64 3.6/7.8 MB, macos-universal 7.0/15.2 MB, windows-x64 3.7/7.2 MB, windows-arm64 3.5/6.7 MB. SHA-256 pins: `spikes/pdfium/pins.json`. Placement: Linux `.so` via Tauri `bundle.resources`; macOS universal dylib in `Contents/Frameworks`; Windows dll next to `lecter.exe`. The worker loads it with `bind_to_library(<absolute resource path>)`, never the system library. LICENSE and `licenses/*` ship for SEC-52 (the About → Licences generator adds them explicitly). The spike README lists the requirements for real packaging.
- Why: the spike's measured result (criterion 3).
- Instead of: `chromium/8086` (newest release ≥ 2 weeks old), which risks symbol mismatches with the 0.9.4 bindings.

## D-088 · Harness call convention and JSON error shape
2026-10-24 · session F-015 · active
- Decision: `lecter-harness <cmd> [args] [--json]`, with `--json` allowed anywhere. With `--json`, stdout gets exactly one JSON line; without it, text on stdout and errors as `lecter-harness: E_X: msg` on stderr. Errors are `{"error":{"code","message","retryable"}}`, mirroring IpcError. Exit 2 for E_INVALID_ARGUMENT, 1 for other codes.
- Why: one result per call is easy for agents to read, and the same shape as the app's IPC errors.
- Instead of: JSON-only output; code-only error objects.

## D-089 · Harness owns ErrorCode until IpcError exists
2026-10-24 · session F-015 · active
- Decision: `crates/harness/src/error.rs` holds all 15 codes; a test parses 18-contracts.md#error-codes and pins the list to it in order.
- Why: core has no IPC error type yet.
- Instead of: adding it to core now (outside F-015's paths).
- Revisit if: F-017 adds IpcError; harness should then reuse it.

## D-090 · Test-home layout and refusal of relative paths
2026-10-24 · session F-015 · active
- Decision: with LECTER_TEST_HOME set, folders are `<home>/config`, `<home>/data`, `<home>/cache`. An empty or relative value is refused with `Error::TestHomeNotAbsolute`. Without it, base folders come from `directories` per the spec's table (macOS config `~/.config/lecter` or absolute `$XDG_CONFIG_HOME`; Windows data/cache `%LOCALAPPDATA%\lecter\{data,cache}`).
- Why: a relative path resolves against the cwd and could land anywhere.
- Instead of: treating an empty or relative value as unset.

## D-091 · Test hooks gated by debug or the test-hooks feature
2026-10-24 · session F-015 · active
- Decision: hook code uses `cfg(any(debug_assertions, feature = "test-hooks"))`. Core has a `test-hooks` feature that harness enables only as a dev-dependency, so feature unification can't reach the app's release build. Hook names (LECTER_TEST_*) appear only in gated docs, because doc comments end up in release rlib metadata.
- Why: 01-architecture.md#debug-only-test-hooks. Checked: a release core rlib has 0 `LECTER_TEST` bytes.
- Instead of: debug_assertions only (would stop harness tests from running in `--release`).

## D-092 · Env-reading paths test runs in a child process
2026-10-24 · session F-015 · active
- Decision: `paths::tests::resolve_reads_the_test_home_from_the_environment` re-runs the test binary (`--exact paths::tests::resolve_in_child_process`, marked by LECTER_PATHS_RESOLVE_CHILD) through `TestEnv::apply` and checks the real `AppDirs::resolve()`.
- Why: `set_var` is unsafe in edition 2024, and cargo test runs tests on parallel threads.
- Instead of: `set_var` under nextest's process-per-test.

## D-093 · directories, thiserror and serde_json added
2026-10-24 · session F-015 · active
- Decision: `directories` (core; 1 new crate, MIT/Apache) for the per-OS base folders; `thiserror` (core; already in tree) for the crate `Error`; `serde_json` (harness; already in tree) moved to root `[workspace.dependencies]` and shared with app.
- Why: Dep-Added trailers on F-015 commits b6aab39 and ab9757a; check_deps OK.
- Instead of: hand-rolled folder lookup.

## D-094 · WebDriver only in test-hooks builds
2026-10-25 · session F-016 · active
- Decision: `tauri-plugin-wdio-webdriver` is an optional dependency that only the `test-hooks` feature enables, and it is registered under `cfg(feature = "test-hooks")`. Plain debug builds (`dev.sh`, `cargo build`) don't embed it. `scripts/e2e-app.sh` builds with `--features custom-protocol,test-hooks`. The LECTER_TEST_PICK/TRUST hooks keep the D-091 gate (debug or test-hooks). This supersedes part of D-049 ("Debug builds embed tauri-plugin-wdio-webdriver").
- Why: measured: Cargo ignores `cfg(debug_assertions)` in target dependency tables and compiles the crate into release builds anyway. F-016 criterion 1 allows "or the test-hooks feature".
- Instead of: the plugin README's `[target.'cfg(debug_assertions)']` table.

## D-095 · All dialogs go through one hookable wrapper; minimal course_open
2026-10-25 · session F-016 · active
- Decision: every native dialog goes through `app/src/dialog.rs`, and `app/src/test_hooks.rs` holds the only test-hook names. `course_open` takes no arguments (the path never comes from the UI). It returns `{path,name,trust}`, canonicalises the folder and accepts only a directory (symlinks resolved; a link to a file is refused). Trust is "ask" unless the debug hook answers. `app/src/ipc/error.rs` has only the 4 codes used so far.
- Why: F-016 criterion 4 needs a folder to open, and a separate pick command isn't in 18-contracts.
- Instead of: a new pick command.
- Revisit if: F-017 replaces `ipc/error.rs` with IpcError; F-018 extends `course_open`.

## D-096 · WDIO tooling lives in ui/ and is pinned to 1.4.0
2026-10-25 · session F-016 · active
- Decision: the WebdriverIO packages are `ui/` devDependencies (tests/e2e has no package.json). `ui/test/e2e-app-config.test.ts` resolves each one, so knip counts them as used. `ui/pnpm-workspace.yaml` sets `allowBuilds: false` for edgedriver, geckodriver and esbuild, because pnpm 12 won't install while an install script is undecided and the embedded provider needs no driver downloads. `tauri-plugin-wdio-webdriver` and `@wdio/tauri-service` are pinned to 1.4.0.
- Why: check_deps only watches `ui/package.json`. 1.5.1 was one day old (the two-week rule).
- Instead of: a separate package in tests/e2e; 1.5.1.

## D-097 · tauri-plugin-wdio-webdriver, tauri-plugin-dialog and @wdio/* added
2026-10-25 · session F-016 · active
- Decision: `tauri-plugin-wdio-webdriver` (MIT, 19 crates, optional, test-hooks only), `tauri-plugin-dialog` (Apache-2.0 OR MIT, 4 crates; called from Rust only, no `dialog:*` capability granted), and dev-only `@wdio/cli`, `@wdio/local-runner`, `@wdio/mocha-framework`, `@wdio/spec-reporter`, `@wdio/globals` (9.x) and `@wdio/tauri-service` 1.4.0 (all MIT, 0 KB gz in the shipped UI).
- Why: Dep-Added trailers on F-016 commit 4bf0bf7. check_deps OK (23 new crates, under 30).
- Instead of: tauri-driver (no macOS); rfd directly.

## D-098 · Right-size reviews and verification
2026-10-25 · maintainer · active
- Decision: one `reviewer` per feature, given SECURITY when the card lists `reviews: ["security"]`; the `security-reviewer` runs at milestone gates and on the 15 deep-security cards. Re-checks resume the same reviewer, and only blocker/major findings send work back. Reviewers read evidence instead of re-running suites. reviewer, security-reviewer and gardener run on Sonnet, builders on Opus. No reviewer for spikes or CI fixes under 40 lines. Explore only for searches across several crates. `scripts/verify.sh` reuses heavy checks on a committed tree that already passed (cheap lints always run; never in CI; agents can't touch the cache; `--no-cache`; the gardener always runs full). Builders run narrow checks per step. New worktrees clone main's `target/` when the disk supports it. macOS/Windows `e2e-app` runs only nightly and on manual runs, plus a branch run before merging three-OS cards. CI timing budgets over ×1.5 are measured once more before failing. Docs-only pushes run lint only. Nightly skips commits it already tested, and its failures are fixed in one batch at gardening. Gardener at gates and every 10 merges. The orchestrator suggests /clear every 4 merges.
- Why: Claude usage windows are the bottleneck. These cut repeated cold-start reviews, repeated verify runs and fix loops on noisy or unreproducible CI failures, while every check still runs somewhere.
- Instead of: two reviewers per security card with a fresh spawn per round, the session model for every agent, every OS on every push, verify re-run on unchanged trees.

## D-099 · Generic maintainer wording; personal setup stays local
2026-10-25 · maintainer · active
- Decision: the kit names a role, not a person. The role word is "maintainer": builders report `NEEDS_MAINTAINER`, cards use `ask_maintainer_first`, scripts check `maintainer_decision()`, decider lines read `<date> · maintainer · active`, and prose says "the maintainer" ("they"). Install hints in `init.sh` and the scripts name packages and links instead of one distro's commands. Personal setup lives in the git-ignored `CLAUDE.local.md` (machine, keys, Node and WebKit quirks, business plans moved from `15-later.md`) and `.claude/settings.local.json` (the second-account credential protections). The orchestrator no longer tracks usage or accounts. LICENSE, the README copyright line, the repo URL and the app id `io.github.jaykuroor.lecter` stay. Git history is not rewritten.
- Why: the repository is public and should work for any maintainer.
- Instead of: naming one person throughout the kit.

## D-100 · Security rules vibe-coded apps miss
2026-10-25 · maintainer · active
- Decision: each audit gap becomes a spec line plus a SHALL criterion with a test on a card that hasn't started. New rules: SEC-25 (a course folder can't loosen global settings; trust re-asked when its `AGENTS.md`, roles, skills or overrides change), SEC-26 (exports embed no local files: Pandoc `--sandbox`, no raw TeX/HTML), SEC-27 (read-only courses enforced in the Rust core), SEC-44 (browser sign-in with PKCE, checked state, one-time loopback listener), SEC-54 (`add_dep.py` stops for packages under 90 days old or with few downloads), ROB-52 (log fields escaped). Extended rules: SEC-12 default spend caps ($5/month, $1/day, 2M tokens/month for models with no price, all changeable in Settings and with `:set`), SEC-14 response size caps (1 MB line, 16 MB response; stream parsers fuzzed), SEC-24 Anthropic `web_fetch` off by default, SEC-33 also covers `lecter-fig:` and `lecter-lib:`, SEC-43 tests for redirects, bad certificates and plain http, SEC-60 the update check is listed and can be turned off. Prompt-injection and XSS fixture suites go on the cards that render or act on AI output. The security-reviewer table gets matching rows. `scripts/check_sec_ids.py` (lint stage) fails when a SEC/ROB rule is cited by no card. `add_dep.py` becomes a protected kit file, and the sandbox allows `api.npmjs.org` for the download count.
- Why: an audit of 19 attack types found 8 fully covered, 8 partly and 3 missing, and 13 of 56 SEC/ROB rules were on no card, so no builder read them.
- Instead of: rules that live only in the spec; unlimited spend on a new install; `web_fetch` on by default.

## D-101 · Tests that catch bugs
2026-10-25 · maintainer · active
- Decision: the default `scripts/verify.sh` set runs mutation testing on the changed lines (`scripts/mutants.py`: cargo-mutants for Rust, Stryker with the Vitest runner for `ui/src`; about a 10-minute cap; local only; skipped during a merge). A surviving mutant fails the check unless a `Mutant-Equivalent: <file> - <mutation> - <why>` trailer has a reason the reviewer accepts. `check_tests.py` also fails a new test that asserts nothing, asserts a constant, compares a value with itself, or only checks `is_ok`/`is_some`/`toBeDefined`/`toBeTruthy`/`not.toBeNull` (exception: a `Test-Smell-Ok` trailer the reviewer accepts), and warns at more than 3 mocks per test file. `docs/TESTING.md` "Tests that catch bugs": mock only at process, network and OS edges; expected values from the spec; an edge case per criterion; behaviour, not wiring; read every new snapshot; red for the right reason (an assertion failure, not a compile error). spec-check gets an edge-case column, the reviewer a test-quality step (weak tests are `major`), the builder report MUTANTS and SNAPSHOTS lines; gardening reads the nightly mutation score. A new M1 card (F-178) adds the full-tree mutation score to `nightly.yml`. `mutants.py` becomes a protected kit file; `init.sh` installs cargo-mutants. `ui/stryker.config.json` names the Vitest runner (so knip sees both Stryker packages) and a `tsconfigFile` that doesn't exist: Stryker's tsconfig rewrite needs TypeScript's JS API, which TypeScript 7 dropped. Mutation testing reruns the same hermetic tests and never calls a real AI provider.
- Why: agent-written tests often pass for wrong code (over-mocking, self-computed expected values, assert-nothing tests). Mutation testing of changed lines finds them while the builder still has the code in context, at CPU cost rather than Claude usage.
- Instead of: line coverage, a mutation score threshold, or nightly-only mutation runs.

## D-102 · IPC bindings by tauri-specta rc.25; ErrorCode in core
2026-10-25 · session F-017 · active
- Decision: commands and IPC types are declared in Rust (`app/src/ipc/mod.rs` `contract()`) and exported by `app/src/bin/export-bindings.rs` to `ui/src/core/bindings.ts` with tauri-specta + specta-typescript pinned at 2.0.0-rc.25 (fills D-048's pin). `--check` exits 0 current, 1 stale/missing, 2 bad flag; verify runs it. `ErrorCode` moves to `crates/core/src/error_code.rs` (specta optional) and the harness reuses it, closing D-089. A guard in `app/src/ipc/guard.rs` applies `validate::payload` limits before tauri-specta dispatches, answering `E_INVALID_ARGUMENT`.
- Why: one source of truth for the contract (18-contracts.md#ipc) and for error codes; rc.26 was 4 days old (two-week rule).
- Instead of: ts-rs plus hand-written wrappers; a mirror enum in app; the harness keeping its own copy.
- Revisit if: tauri-specta 2.0 ships stable.

## D-103 · tauri-specta, specta, specta-typescript and app deps added
2026-10-25 · session F-017 · active
- Decision: `tauri-specta` (MIT, 9 crates), `specta-typescript` (MIT), `specta` (MIT; optional in core), and already-in-tree `tracing`, `serde`, `serde_json`, `lecter-core` (app, harness), plus dev-only `tauri` `test` feature for a MockRuntime test of the guard.
- Why: Dep-Added trailers on F-017 commits ca883eb and bb66b88.
- Instead of: see D-102.

## D-104 · Tauri isolation pattern stays off in v0 (SEC-36)
2026-10-25 · session F-017 · active
- Decision: the main window keeps Tauri's default (brownfield) pattern, not `app.security.pattern = isolation`.
- Why: spikes/isolation measured (Chromium, i7-14700KF) 0.12 ms p99 added per 1 B call but 6.3 ms at 16 KB and 22.5 ms at 64 KB, all main-thread JS, which breaks the 8 ms keystroke budget for prompts and large edits. The threat (a compromised front-end dependency forging IPC) is already limited by the SEC-30 CSP, one least-privilege capability per window (SEC-31), Rust-side validation of every command (SEC-32) and a figure frame with no IPC.
- Instead of: isolation on for every call.
- Revisit if: the main webview ever runs third-party or remote code, or a WebKitGTK measurement shows under 1 ms per call at 64 KB.

## D-105 · Course listing lives in lecter-core
2026-10-25 · session F-018 · active
- Decision: `lecter_core::course::open(&Path) -> CourseListing` is shared by `course_open` and `lecter-harness course open`. Shape `{path,name,lectures:[{name,path}],slides:[{name,path}]}` with course-relative `/` paths; IPC adds `trust` beside it (serde flatten), keeping F-016's `{path,name,trust}`. Only the top level of lectures/ and slides/ is listed: lectures are `*.md` (case-insensitive), slides any regular file; hidden files, folders, dangling links and non-Unicode names are left out; sorted by name. Windows `\\?\` prefixes are stripped from the shown path. Core `Error` gained the course variants and `code()`.
- Why: one source, identical JSON for IPC and harness (criterion 4); 02/03 specs.
- Instead of: canonicalising in the app; nesting the listing under `course`; a recursive listing.

## D-106 · Any entry escaping the course fails the open
2026-10-25 · session F-018 · active
- Decision: every entry (not only symlinks) is canonicalised and checked with `within()`, which also refuses `..`; an entry outside the course root fails the whole open with E_NOT_TRUSTED naming the course-relative entry. A link loop is an I/O error. More than 10,000 entries in a subfolder (hidden ones count) is E_INVALID_ARGUMENT.
- Why: criterion 2 and SEC-35; Windows junctions; `Path::starts_with` accepts `/c/slides/../../etc`. The cap is the contract's list limit and bounds the work.
- Instead of: silently skipping escaping entries (Q-012); truncating at the cap.

## D-107 · Buttons handle Enter/Space in the app
2026-10-25 · session F-018 · active
- Decision: the Open course button handles Enter and Space in a keydown handler (preventDefault, so a real key press doesn't also click). Keyboard paths in e2e flows rely on app key handlers, not native default actions.
- Why: tauri-plugin-wdio-webdriver 1.4.0 sends keys as synthetic `KeyboardEvent`s, which never trigger a button's native activation; the author's first run failed on it. Key reachability shouldn't depend on browser activation, and the future keymap works the same way.
- Instead of: replacing the Enter step with a click; a new global shortcut (a keybinding is the maintainer's call; `:open` comes with the Vim layer).

## D-108 · F-019 adds the pinned PDFium CI cache (Q-009)
2026-10-25 · maintainer · active
- Decision: F-019 (the first shipping crate that loads PDFium) adds a CI step that runs the pinned, SHA-256-checked PDFium fetch with `actions/cache` keyed on the pins file, and an `init.sh` step that does the same locally. Tests only read the verified local library and stay offline; D-086's network exception does not extend to lecter-parse.
- Why: tests must not hit the network (AGENTS.md); downloading ~25 MB on every fresh runner is slow and flaky.
- Instead of: leaving Q-009 to a planning session; per-test downloads.

## D-109 · WebDriver plugin and service move to 1.5.0
2026-10-25 · session CI-17ae5e6 · active (supersedes D-096's 1.4.0 pin)
- Decision: `tauri-plugin-wdio-webdriver` =1.5.0 and `@wdio/tauri-service` 1.5.0 (both MIT, dev/test-hooks only, published 2026-10-08). They move together.
- Why: plugin 1.4.0 needs webview2-com 0.38 / windows 0.61 while tauri 2.12.5 uses 0.39 / 0.62, so it didn't compile on Windows (two `ICoreWebView2` types). Service 1.4.0 runs the msedgedriver check on Windows even for the embedded server and then never sets the session's hostname/port ("No browserName … nor hostname or port"). Branch CI run 40229046760 green on all three OSes.
- Instead of: 1.5.1 (2026-10-24, under two weeks); downgrading tauri; `autoDownloadEdgeDriver: true`.

## D-110 · Platform-honest tests for origins, file names and paths
2026-10-25 · session CI-17ae5e6 · active
- Decision: IPC guard tests call from the platform's local origin (`http://tauri.localhost` on Windows/Android, `tauri://localhost` elsewhere). The non-UTF-8 file-name test is `cfg(all(unix, not(target_vendor = "apple")))` (APFS/HFS+ refuse such names). e2e flows compare paths with `realpathSync.native` (expands Windows 8.3 short names like Rust's canonicalize). Doc comments on specta `Type`s are compiled into the binary, so they must not name test-only tools.
- Why: each was a CI failure on macOS, Windows or release-check that Linux didn't show.
- Instead of: runtime skips; loosened path comparisons; a weaker release check.

## D-111 · Worker protocol framing and block shape
2026-10-25 · session F-019 · active
- Decision: frames are a 4-byte little-endian length plus a postcard body, capped at 128 MiB and checked before allocation on both ends. `Block{id "s<p>b<n>", page, kind, text, bbox, method, confidence}`; bbox in PDF points with a top-left origin. Worker failures carry `FailCode` io/unreadable/limit/engine, and every worker failure maps to E_PARSE_FAILED. SEC-04 limits in SI units (500 000 000 B file, 1 000 000 B text per page); the worker enforces file, page and text limits.
- Why: 18-contracts says only "length-prefixed"; one error code keeps the UI simple.
- Instead of: a varint prefix; a separate E_IO.
- Revisit if: image/OCR features need the megapixel and depth limits enforced (F-057+).

## D-112 · Core runs the worker with tokio; fakes in Python
2026-10-25 · session F-019 · active
- Decision: the core spawns the worker with tokio (process, time, io-util, macros; `kill_on_drop`; stderr inherited) under a 60 s limit. Core tests use small Python fake workers (crash mid-frame with `os._exit(70)`, real `os.abort()` at start, hang, garbage, bad Hello, exit 0/7); they probe python3, python, py. On Windows an exit code ≥ 0xC0000000 is shown as hex ("it crashed (0xC0000409)").
- Why: core tests can't build the lecter-parse binary; `os.abort()` exits 0xC0000409 on Windows (CI run 40230309165); NTSTATUS codes are documented in hex.
- Instead of: std threads; re-executing the test binary (libtest writes to stdout); a signed-decimal Windows code.

## D-113 · PDFium location and the CI cache
2026-10-25 · session F-019 · active
- Decision: lecter-parse loads PDFium only from an absolute `--pdfium-dir`, with no fallback. Dev and tests find `target/pdfium/chromium-7881/<host>` by walking up; `LECTER_PDFIUM_DIR` overrides it in the harness and tests only. The fetch script and pins stay in `spikes/pdfium`. The cache step lives in `.github/actions/setup/action.yml` (actions/cache v6.0.0 pinned by SHA, key os/arch + pins.json hash), used by every job. `lecter-harness parse` runs itself as the worker (`__parse-worker`). The bundled app's PDFium dir is passed by whoever builds `WorkerCommand` (packaging feature).
- Why: D-087 (never the system library), D-108 (tests offline); the setup action already holds setup steps; the sibling lecter-parse binary is missing under `-p` and cargo-mutants.
- Instead of: ci.yml (protected); requiring a built lecter-parse for the harness.

## D-114 · lecter-parse dependencies added
2026-10-25 · session F-019 · active
- Decision: `postcard` (3 crates), `pdfium-render` (D-085), `tokio` (workspace dependency, default features off), plus already-in-tree `serde`, `thiserror`, `serde_json`.
- Why: Dep-Added trailers on F-019 commits; check_deps OK.
- Instead of: see D-111 and D-112.

## D-115 · The buffer holds the whole lecture file
2026-10-25 · session F-020 · active
- Decision: the CodeMirror document is the lecture .md text. Front matter, `:::` fences and `## title` lines are hidden by block decorations and `[..]{#id}` brackets by inline ones; a transaction filter keeps the cursor on visible text, moving off hidden lines in the direction of travel. The slide source line reads "07-covariance.pdf · slide 3" from the `src` letter and the front-matter `slides:` list. Vim mode is exposed as `data-vim-mode` on the buffer.
- Why: 18-contracts' journal uses byte offsets into the .md (F-021); `i` must type inside the span.
- Instead of: a projected document built from parsed blocks.
- Revisit if: CRLF lectures appear (CodeMirror normalises to LF, breaking byte offsets).

## D-116 · j/k/gg/G move by element
2026-10-25 · session F-020 · active
- Decision: j/k move to the next/previous element and gg/G to the first/last, skipping hidden and blank lines, keeping the column within the text; a count picks the nth element. With an operator pending they move by plain lines.
- Why: 10-keymap.md says "line or element".
- Instead of: Vim's raw line motions.

## D-117 · lecture_open is session-gated; CodeMirror packages added
2026-10-25 · session F-020 · active
- Decision: `lecture_open(course, path)` accepts only a course that `course_open` returned this session (`app/src/ipc/session.rs`) and only `lectures/<name>.md`; canonicalised, within the course root, UTF-8, capped at 16 MiB; new core errors NotALecture, LectureNotFound, LectureTooLarge, NotUtf8, ReadFailed. The capability adds only `allow-lecture-open`. Dependencies: @codemirror/state 6.7.6, @codemirror/view 6.43.14, @codemirror/commands 6.11.1, @replit/codemirror-vim 6.4.0 (MIT; the F-001 spike versions, D-080). Main JS chunk 138 KB gz. The buffer perf test launches its own Chromium with vsync off under every Playwright project (D-080 method).
- Why: SEC-32/35; Dep-Added trailers on F-020 commits.
- Instead of: an unrestricted path argument.

## D-118 · Buffer perf on CI: apply the CI rule, then investigate
2026-10-25 · maintainer · active
- Decision: main CI run 40254435353 measured `keystroke_p99_ms` 26.7 ms (p50 13.3, p95 21.8; Chromium 156 headless, vsync off, 200-slide fixture) on ubuntu-24.04 against the 8 ms budget (4.2 ms on the author's machine). The CI fix makes `ui/e2e/buffer-perf.spec.ts` follow 14-quality's CI rule (×1.5 allowance under `--ci`, one re-measure, both values reported; ×1 locally) and investigates the 6× gap (GPU/software rasterisation, flags, CPU). The budget itself is not loosened. If CI is still over 12 ms, the numbers go in a new D-entry and the author chooses the next step.
- Why: 14-quality "Never loosen a budget to pass. Measure, record a D-entry, and ask the maintainer."
- Instead of: running the check locally only until F-025; reverting F-020.

## D-119 · Timing rule in the buffer perf check; regular files only
2026-10-25 · session CI-a0174c9 · active
- Decision: `ui/e2e/perf/timing-budget.ts` implements 14-quality's timing rule (×1 on one run locally; under `CI`, ×1.5 with one re-measure when the first run is over, failing only if both are over, both values reported; at most two runs). It reads `keystroke_p99_ms` from `tests/perf/budgets.json` when that exists (F-025) and uses the spec's 8 ms until then; a broken file throws. The buffer perf spec runs with `trace: "off"` (spec-scoped) and takes a cross-worker lock (`ui/e2e/perf/exclusive.ts`) so its two Playwright-project copies don't overlap; other specs still run beside it. Results also go to `GITHUB_STEP_SUMMARY`; the probe adds an input→frame / frame→painted split. `lecture_open` checks `metadata().is_file()` before opening and re-checks the handle, so folders and FIFOs are refused (NotALecture) without blocking.
- Why: CI run 40254435353 (26.7 ms p99) combined two parallel copies, the trace recorder (snapshot per action) and ~2× slower cores; graphics weren't the cost (frame→painted p50 0.1–1.3 ms). Branch run 40258103961 passed on all three OSes. F-025 should reuse timing-budget.ts.
- Instead of: loosening the budget; editing the protected playwright.config.ts.

## D-120 · The keystroke check gets its own `perf` CI job now
2026-10-25 · maintainer · active (follows D-118)
- Decision: the mocked-core keystroke check (`ui/e2e/buffer-perf.spec.ts`) leaves the parallel `e2e` Playwright run and runs alone, once, in its own `perf` CI job on every push (the job name 16-ci-cd.md reserves). The budget and the CI rule (×1.5, one re-measure) are unchanged. F-025 later replaces the job's command with `scripts/verify.sh --stage perf` (`tests/perf/budgets.sh --ci`, real app).
- Why: main CI run 40263523685 measured p99 13.9/12.7 ms (chromium project, fail) and 23.0/7.5 ms (webkit project, pass) against the 12 ms CI limit, with p50 ~5 ms throughout: the worst 1% on a shared 4-vCPU runner swings with whatever runs beside it. The `e2e` job itself now takes ~1 min in Playwright's image.
- Instead of: running it once, last, inside `e2e`; a larger paid runner.

## D-121 · The `blake3` crate is approved
2026-10-26 · maintainer · active
- Decision: Lecter uses the `blake3` crate (3 new crates, a `cc` build step for its SIMD code) for every BLAKE3 hash: journal `base`, the content-hash cache and the parse cache. F-021 replaces its in-tree `journal/hash.rs` with the crate before it merges. Commits adding it carry `Deps-Approved: D-121`.
- Why: add_dep refused the crate as native, and F-021's builder wrote BLAKE3 by hand instead of asking. A widely used, audited and SIMD-fast crate beats a hand-written hash, especially once whole PDFs get hashed.
- Instead of: keeping the in-tree hash (slow on large files, ours to maintain); the crate's `pure` feature only (no C build step, slower).

## D-122 · Journal and save design
2026-10-26 · session F-021 · active
- Decision: one save thread per open lecture (std mpsc, inbox bound 64, recv_timeout to the next deadline; no polling). Journal fsync ≤ 250 ms after the first unsynced write; the .md save is a trailing 1 s debounce after the last edit, retried a debounce later if it fails; every lecture is saved on RunEvent::Exit and opening a lecture closes the others. Save order: temp file (exclusive), fsync, checkpoint record + fsync, rename, dir fsync. After a save, a journal over 64 KiB starts over.
- Why: a crash at any point still replays correctly (a checkpoint after the rename would look like an outside edit); ROB-11.
- Instead of: checkpoint after the rename; a tokio task per lecture.

## D-123 · Edits travel as UTF-16 positions
2026-10-26 · session F-021 · active
- Decision: `lecture_apply_edits(course, path, edits: [{from, to, text}])` takes CodeMirror's UTF-16 positions; the core converts them to UTF-8 byte offsets with ropey. A batch that doesn't fit is refused whole. The UI sends batches in order, one call at a time, ≤ 1000 edits / 131072 units each, splitting pastes into 16384-unit pieces without breaking surrogate pairs.
- Why: the journal's offsets are UTF-8 bytes (18-contracts); the UI shouldn't compute them.
- Instead of: byte offsets computed in the UI.

## D-124 · Replay rules and limits
2026-10-26 · session F-021 · active
- Decision: replay applies records after the last checkpoint whose base matches the .md; a truncated last line is ignored; a damaged middle line, an unmatched base or a result over MAX_LECTURE_BYTES (16 MB) is a Mismatch, and the journal is renamed to `<stem>.log.kept-<ms>` and not applied. Journals over 64 MiB, and links, are never read. CRLF lectures are read as LF and saved as LF only after an edit (03 says LF).
- Why: a journal must never produce a lecture the app then refuses to open; F-051/F-070 build on the kept files.
- Instead of: rewriting CRLF files on open; applying partial journals.

## D-125 · F-021 dependencies
2026-10-26 · session F-021 · active
- Decision: `ropey` (MIT, 2 crates; the rope 01-architecture names), `serde_json` (already in tree; the journal is JSON lines), `blake3` (3 crates, Deps-Approved: D-121).
- Why: Dep-Added trailers on F-021 commits; check_deps OK.
- Instead of: an in-tree BLAKE3 (removed, see D-121).

## D-126 · The `tantivy` crate is approved for search
2026-10-26 · maintainer · active
- Decision: `lecter-index` uses `tantivy` 0.27 (MIT, no native crates) with `default-features = false` and features `mmap,lz4-compression`, about 48 new crates. Commits adding it carry `Deps-Approved: D-126`.
- Why: 05-retrieval.md#search names Tantivy for BM25; `mmap` keeps the index on disk in the course cache, and `lz4-compression` uses the pure-Rust lz4_flex (~1 crate). It is over the 30-crate limit, so the maintainer approves it.
- Instead of: the default features (zstd, native; the stemmer); `stopwords` only (46 crates, no on-disk index); a hand-written index.

## D-127 · The BM25 index holds one document per block
2026-10-26 · session F-022 · active
- Decision: each lecture block is one Tantivy document with fields text, breadcrumb ("lecture title › slide title"), tags, kind=slides, source, lecture, slide, block. The index lives at `<course>/.lecter/cache/index` (MmapDirectory), created with `lecter_core::course::ensure_dir`; an unreadable index or one with another schema is erased and rebuilt empty, and lectures are indexed again when opened.
- Why: F-022's criterion asks for block id fields; 02-course-folder says cache/ holds the index and can be deleted.
- Instead of: one passage per slide as in 05-retrieval.md#indexing (the AI retrieval tier, later); the app cache dir.
- Revisit if: the retrieval cards need slide passages; they can sit beside the block documents.

## D-128 · When and how search indexes and queries
2026-10-26 · session F-022 · active
- Decision: lecture_open starts a background index after it answers; search_find first re-indexes the open lectures (a text fingerprint skips unchanged ones). Queries go through the field tokenizer into an OR of TermQuery on text plus breadcrumb (boost 0.5), at most 64 terms, never Tantivy's QueryParser. At most 50 hits (MAX_HITS) for search_find and the harness. FindHit carries no score over IPC (specta types f32 as number|null); list order is the rank, the harness JSON has the score. One writer per write (15 MB), dropped after commit; reader ReloadPolicy::Manual; lock contention → E_LOCKED.
- Why: unsaved edits stay searchable without indexing on every keystroke; no query syntax from untrusted input; no meta.json polling.
- Instead of: indexing on every edit; QueryParser.

## D-129 · F-022 dependencies
2026-10-26 · session F-022 · active
- Decision: `tantivy` 0.27 (MIT, 49 crates, default features off, `mmap,lz4-compression`; Deps-Approved: D-126); `thiserror`, `serde` added to lecter-index (already in the tree).
- Why: Dep-Added trailers on F-022 commits; check_deps OK; Cargo.lock has no zstd or stemmer crates.
- Instead of: see D-126.

## D-130 · Node comes from fnm, pinned to 24.22.1 (supersedes D-061)
2026-10-26 · maintainer · active
- Decision: Node comes from a version manager (fnm) honoring `ui/package.json` `engines.node`, now exactly 24.22.1; the distro `nodejs` packages are not used, and pnpm comes from `corepack enable` (it reads `packageManager`). init.sh and verify.sh fall back to fnm's install of the pinned version (`${FNM_DIR:-$XDG_DATA_HOME/fnm}/node-versions/v<pin>/installation/bin/node`, still overridable with `LECTER_NODE_FALLBACK`); loop.sh, live.sh and worktree_setup.sh source `scripts/node_env.sh`, which puts that dir first on PATH when `node` isn't the pin; the edit-format hook finds Node the same way. They read fnm's folder instead of running `fnm env`/`fnm use`, so nothing depends on an interactive rc file or writes under XDG_RUNTIME_DIR. `fnm install`, `corepack enable` and corepack's pnpm download run outside the sandbox.
- Why: the distro packages lagged security fixes; 24.18.0 has known vulnerabilities. Hooks and loop runs start without a login shell, so they can't rely on `fnm env`.
- Instead of: `/usr/bin/node-24` from the distro (D-061); a sandbox write rule for fnm's multishell dir; making verify.sh source the helper (D-074 keeps it self-contained).

## D-131 · The app answers with an offline sample provider until real adapters exist
2026-10-26 · session F-023 · active
- Decision: `ScriptedProvider` (timed deltas, in-process, in lecter-ai) is both the tests' fake and the app's default "sample" provider (`Glosses::default()`); its text says it is a sample, ~90 ms per word. tests/fake-provider stays for F-080's HTTP/SSE fake.
- Why: check_arch forbids app→fake-provider; the card asks for one gloss from the fake provider; the reviewer accepted it against the no-fake-data rule because it says it's a sample.
- Instead of: an SSE server plus an HTTP client now.
- Revisit if: F-080 / the first real adapter lands: it must replace the sample as the default.

## D-132 · Provider trait and GlossStream events
2026-10-26 · session F-023 · active
- Decision: the Provider trait is dyn-compatible (stream() returns a BoxFuture; EventStream is a bounded mpsc of 64). GlossStream events: started{gloss,model}, delta{text}, done{markdown}, stopped{markdown|null}, failed{error}. gloss_request returns the gloss id at once; gloss_cancel is idempotent. Gloss ids are g-xxxx (4 hex, 8 after 32 collisions) from std RandomState, unique within the lecture and the running streams.
- Why: providers are chosen at run time; ids short enough for the .md.
- Instead of: async fn in the trait.

## D-133 · The UI saves the gloss; Esc keeps the partial answer
2026-10-26 · session F-023 · active
- Decision: the core sends the finished fenced div in done/stopped and the UI inserts it under its block (after that block's earlier glosses) through lecture_apply_edits, so it is journaled and `u` undoes it. Esc (and the 30 s time budget) stop the stream and save what arrived; a stream stopped before any text saves nothing. Esc in the buffer also closes a prompt or a failed card.
- Why: one write path for the lecture (F-021); no side writes from the core.
- Instead of: the core writing the gloss to the file.

## D-134 · Untrusted text in prompts and answers
2026-10-26 · session F-023 · active
- Decision: breadcrumb and slide text go inside `<untrusted_source>` with &, < and > escaped, and the system prompt says not to follow instructions in it. Answer lines starting with `:::` or `[` (also indented) get a backslash; the question is collapsed to one line; the model name loses ", \, } and newlines. The answer is rendered with textContent only. Dependencies: tokio-util, thiserror, tracing, serde, tokio for lecter-ai (all already in the tree, 0 new crates).
- Why: 13-security.md (untrusted input; model output never executed or parsed as structure).
- Instead of: rendering answer markdown before F-094.

## D-135 · Skeleton figures are ```fnplot blocks inside the gloss
2026-11-01 · session F-024 · active
- Decision: a ```fnplot code block inside a gloss div is a figure; the widget goes under its closing fence. The sample provider (D-131) answers plot/graph/chart/figure/draw/sketch questions with the spec's fnplot example. A leading backslash before `[` or `:::` (D-134 escaping) is removed only inside spec text; the escaping itself is unchanged, and fence closers are tested on the raw line first.
- Why: the spec doesn't say how the skeleton embeds a figure; Markdown viewers show it as code.
- Instead of: `::: {.figure}` with assets (F-145); a second provider.
- Revisit if: F-145 defines the stored figure form (Q-016).

## D-136 · Own expression grammar for fnplot, with caps
2026-11-01 · session F-024 · active
- Decision: a recursive-descent parser compiles expressions to closures: at most 200 characters and nesting depth 32, functions and constants looked up in Maps, never eval/Function/innerHTML. Spec caps: 4 KB, 4 exprs, 8 params, 5000 points, |n| ≤ 1e9 for spec fields; params use their value (sliders with F-140). Seeded scatter uses mulberry32 with a fixed seed.
- Why: model output is untrusted (13-security); 08-figures names no library ("rendered by Lecter"); under 150 lines.
- Instead of: mathjs or function-plot (large bundles).

## D-137 · Figures draw lazily, only in view
2026-11-01 · session F-024 · active
- Decision: one shared IntersectionObserver; the plot runtime is its own lazy chunk (3.6 KB gz) loaded on first view; out of view the drawing is dropped and the stage keeps its size; stale async loads are discarded; the SVG is built with DOM calls and textContent only, with no href, src or url(). No dependency added.
- Why: criterion 3 (re-render only when scrolled into view); no polling; no network.
- Instead of: drawing every figure on open.

## D-138 · First real-app perf run fails; re-measure before merging F-025
2026-11-01 · orchestrator, decider: maintainer · active
- Decision: F-025 stays unmerged. Its first CI perf run (run 41359945525, debug + test-hooks build, ubuntu-24.04 under Xvfb, WebKitGTK) measured keystroke_p99_ms 15/16 (limit 12), cold_open_ms 1409/1043 (limit 600), idle_rss_mb 620.61 (app 214.7, WebKitWebProcess 355.0, WebKitNetworkProcess 50.8; budget 150), rss_300_slides_mb 653.21 (budget 250), idle_cpu_pct 9.25 (budget 0.5); ttft_overhead_ms 20 and ui_main_chunk_kb_gz 141.94 passed. The builder re-measures on a release-profile build with test-hooks, adds a per-process CPU and memory breakdown to find the idle CPU source, and re-runs CI on the branch; what still fails goes back to the maintainer with numbers. No budget is loosened.
- Why: merging would turn main red on every push; a debug build overstates open time and memory, and idle CPU at 9% points to work running while idle.
- Instead of: merging and stopping the line for perf fixes, or blocking F-025 for the planning session.

## D-139 · First release-build perf measurements; F-025 blocked for planning
2026-11-01 · orchestrator, decider: maintainer · active
- Decision: the first real-app measurements (F-025 criterion 5) are the release + test-hooks CI run 41361813736 on ubuntu-24.04 under Xvfb: keystroke_p99_ms 15/16, cold_open_ms 2906/973, idle_rss_mb 602.29 (PSS 414.6), rss_300_slides_mb 629.85 (PSS 450.7), idle_cpu_pct 12.55 (95% llvmpipe threads in WebKitWebProcess), ttft_overhead_ms 21, ui_main_chunk_kb_gz 141.94. Five budgets fail, so F-025 is blocked unmerged and the budgets and fixes go to the planning session (Q-017). No budget is loosened.
- Why: merging would keep main red; the spec says to measure, record and ask rather than loosen.
- Instead of: merging and stopping the line, or another diagnostic round first.

## D-140 · Vim and IME work together in all three webviews; normal-mode IME text needs a guard
2026-11-01 · session F-027 · active
- Decision: criterion 1 holds on WebKitGTK, WKWebView and WebView2 (CI runs 41364496453 and 41369104620): composed text lands once in the state, on screen and in the saved .md, and no Vim key fires while composing, because CodeMirror keeps keys from Vim while a composition is active (composing > 0). WebKitGTK 25/26 and WKWebView 25/26 checks ok; WebView2 passed every asserted check (detail lines not captured). Gaps on WebKitGTK and WKWebView: (a) a 2+ character commit in normal mode is inserted into the slide line (against 09-ui#editing) and Vim's `u` doesn't remove it; (b) a keyCode-229 key named by its character, sent before compositionstart, runs as a Vim key (Chromium sends `Process`, which Vim skips). Workaround chosen (not built; for the card that owns ui/src/features/buffer/editorState.ts): an inputHandler placed before vim() that drops text unless Vim is in insert or replace mode, plus a capture-phase keydown listener on the editor's outer element that calls stopPropagation (never preventDefault, which would cancel the IME) for `isComposing || keyCode === 229`, except `Process`, `Unidentified` and `Dead`.
- Why: real-app CI measurements on all three webviews; the gaps break the slide-line read-only rule.
- Instead of: leaving IME handling to codemirror-vim, or swallowing the keys in a CodeMirror key handler (returning true calls preventDefault and cancels the composition).

## D-141 · IME spike method: synthetic composition played in-page, checks logged then asserted
2026-11-01 · session F-027 · active
- Decision: the flow plays the composition inside the page in UI Events order (keydown Process/229 → compositionstart → per candidate compositionupdate, beforeinput insertCompositionText, DOM text change, input → keydown Enter/229 → compositionend → keyup); each check prints `IME <webview> <case> <check>: ok|FAIL|observed` and one expect asserts them together. Behaviour the spec doesn't require of this card (normal-mode commit landing, early keyCode-229 key, `u` undoing it) is logged as observed, not asserted, and cleanup restores the text through the editor without relying on `u`.
- Why: WebDriver can't drive a real IME; execCommand insertText would make CodeMirror's Safari path end the composition after 20 ms; one CI run shows every webview's failures; e2e-app on Linux gates every push to main.
- Instead of: execCommand like restart.ts, or stopping at the first failure.

## D-142 · Figure frame sandbox per webview: CSP alone can't keep WebView2 off the network
2026-11-02 · orchestrator (F-028 spike, unmerged), decider: maintainer pending (Q-019) · active
- Decision: measured in CI runs 41461890948 and 41472212630 (branch feat/F-028-figure-frame). Sandboxed frame (allow-scripts only), CSP sent as a header: on all three webviews the parent DOM, storage (local/session storage, cookie, indexedDB, caches, storage directory) and both IPC endpoints are blocked, and no frame call got a Tauri answer. Network: 15 of 16 vectors blocked everywhere; `<link rel=prefetch>` reaches the network from both frames on WebView2 (Edg 155; also Chromium 156 locally), so criterion 1 can't hold with the CSP alone. WebKitGTK and WKWebView never match `'self'` in an opaque-origin frame, so the spec's `script-src 'self' lecter-lib:` blocks a figure's own script (a frame naming its script origin explicitly ran on all three). Watchdog chosen: in-page heartbeat plus an outside-the-page (core-side) heartbeat, 250 ms beat, flagged after 1.5 s without one, detection = the earlier leg. WebView2 runs the frame on its own thread (in-page leg 1285/1452 ms); WebKitGTK and WKWebView run it on the parent's thread (parent gap 5091/5011 ms in a 5 s loop), so only the outside leg can detect it there; run 2's WebKit jobs passed the ≤ 2000 ms assertion (per-check lines are in the run's job summaries). Idle pings answered in ≤ 15 ms. On WebView2 the frame also holds `__TAURI_INTERNALS__` and invoke (wry injects init scripts into subframes); IPC is blocked only by connect-src and by wry not listening to subframe messages.
- Why: spike evidence; reviewer agreed the WebView2 prefetch result makes criterion 1 impossible as written.
- Instead of: relying on the CSP alone, or an in-page watchdog alone.

## D-143 · Performance preset is `ui.performance`; Balanced highlights after 200 ms
2026-11-02 · planning session, from the maintainer's D-081 (Q-006) · active
- Decision: the D-081 preset is the setting `ui.performance` (`performance` | `balanced` default | `quality`), on a new Settings → Performance page and with `:set`; it applies to open lectures at once. Balanced runs Markdown highlighting after a 200 ms typing pause and loads KaTeX on the first math in view, outside the main chunk. Quality shows "Can add input lag on slower machines." Spec: `12-settings-theme-onboarding.md#performance-preset`, `09-ui.md#editing`. Criteria: F-030 (key), F-040 (`:set`), F-045 (page), new F-074 (buffer behaviour).
- Why: D-081 fixed the three presets and the Balanced default; the key name and the pause length were the gaps. 200 ms keeps highlighting visibly prompt while leaving bursts of typing (≤ 150 ms between keys) parse-free.
- Instead of: a `performance.preset` namespace (one key doesn't need its own group); a pause of 500 ms or more (highlighting would feel late).
- Revisit if: F-074's trace shows parses inside typing bursts or highlighting feels late in the gate.

## D-144 · Windows parse sandbox: accept the LPAC boundary
2026-11-02 · planning session, decider: maintainer (Q-008) · active
- Decision: SEC-01 on Windows is LPAC AppContainer + job object. Besides its input (passed as a handle), the worker may read only files whose ACL grants ALL RESTRICTED APPLICATION PACKAGES read/execute (OS and installed program files); everything else, including the whole user profile, is denied. The rest of SEC-01 is unchanged. F-005 criterion 1 now asserts a user-profile file is denied on Windows instead of win.ini; F-005 is unblocked to finish on feat/F-005-os-sandbox and merge.
- Why: LPAC honours that grant by design (CI run 40154388308, 55/56 with only win.ini readable); the lockdown-token alternative (30934ba) failed to start (0xC0000135). OS files hold nothing of the student's.
- Instead of: a lockdown token without AppContainer, which needs its start-up DLL loading solved first.
- Revisit if: a parser exploit needs OS file contents to escalate, or the lockdown token is made to start.

## D-145 · Figure frames: native request filter, scheme CSP, core-side watchdog
2026-11-02 · planning session, decider: maintainer (Q-019) · active
- Decision: 08-figures#sandbox-pages now requires (1) a native request filter refusing every figure-frame request not to lecter-fig:/lecter-lib: (WebView2 WebResourceRequested; WebKit content rule list or scheme-handler checks), built for real in F-141 and proven in F-028 criterion 1 together with the CSP; (2) CSP `script-src lecter-fig: lecter-lib:` instead of `'self'`, proven per webview in F-141; (3) a core-side watchdog (webview.eval heartbeat every 250 ms, flagged after 1.5 s) that kills the frame from the native side (F-142); (4) the core drops IPC not from a window's main frame (SEC-31, F-141). F-028 gets the filter as `app/src/figure_filter*`, compiled only with test-hooks until F-141 ships it, so it isn't written twice; F-028 and F-142 now take a security review.
- Why: D-142: `<link rel=prefetch>` leaves the frame on WebView2 despite `default-src 'none'`; WebKit never matches `'self'` in an opaque-origin frame; WebKit runs the frame on the parent's thread; WebView2 injects Tauri's IPC into subframes.
- Instead of: the CSP alone, or an in-page watchdog alone.

## D-146 · Perf budgets: per-OS memory by PSS, keystroke gated off CI, idle draws nothing
2026-11-02 · planning session, decider: maintainer (Q-017) · active
- Decision: in 14-quality#performance-budgets, idle_rss_mb and rss_300_slides_mb get per-OS targets (`per_os`), counting Lecter's processes by RSS and the webview's by PSS (macOS phys_footprint, Windows private working set). Target = first release-build measurement + 10 %, rounded up to the next 10 MB; Linux from D-139 (414.6, 450.7 MB PSS) → 460 and 500 MB; macOS and Windows from F-025's dispatch run; targets only go down afterwards. keystroke_p99_ms stays 8 ms, but the real-app trace gates only with hardware rendering (local, at each milestone gate); with --ci it prints REPORT and the mocked-core trace gates. New M0.5 cards: F-029 (nothing redraws while idle; the caret blinks 10 s after the last input, then stays solid, as GTK does) and F-179 (cold open under 600 ms on CI). F-025 depends on both, is unblocked, and merges once its gate passes.
- Why: WebKitWebProcess alone exceeds 150 MB RSS and shared libraries are counted once per process by RSS; idle CPU is 95 % llvmpipe redraw; Xvfb/llvmpipe keystroke timings measure software rendering, not Lecter (D-080 measured 11–12 ms on WebKit).
- Instead of: one 150/250 MB total for every OS; a caret that never blinks (less visible) or blinks forever (redraws while idle); gating keystrokes on software-rendered CI.
- Revisit if: F-029 lowers idle memory (tighten the Linux targets to the new measurement), or a CI runner with hardware rendering becomes available.

## D-147 · F-005 spike: Windows/macOS-only mutants are covered by the cross-OS test job
2026-11-02 · orchestrator, decider: maintainer · active
- Decision: the 87 mutants that survive in spikes/os-sandbox's Windows-only (windows.rs, Windows probe lines) and macOS-only (macos.rs) code are accepted for F-005. The Linux mutation run compiles that code out; the CI `test` job on macOS and Windows is its proof. The card that ports the sandbox into the parse worker (SEC-01, F-052..F-054) gets its own mutation run.
- Why: spikes don't ship, and mutants.py runs only on the Linux host, so these mutants can't be built there, let alone killed.
- Instead of: blocking F-005 until mutation testing runs on macOS/Windows CI.
- Revisit if: mutants.py gains a macOS/Windows CI run (Q-entry: run it for cross-OS crates before SEC-01 ships).

## D-148 · Parse-worker OS sandboxes: GO on Linux, macOS and Windows (F-005)
2026-11-02 · F-005 builder, recorded by the orchestrator · active
- Decision: the parse worker's sandboxes are Linux seccomp + Landlock (+ RLIMIT_AS 1 GiB, closed fds, PDEATHSIG, Landlock signal scope), a macOS sandbox profile, and a Windows LPAC AppContainer + job object, picked by cfg(target_os). Go/no-go: Linux GO (21/21 on Fedora 44, kernel 7.2.11, Landlock ABI 10), macOS GO (CI run 41513695098), Windows GO under D-144 (CI run 41513695098, including a file under %USERPROFILE% being denied). On Windows, profile creation, the exe's DACL grant and CreateProcessW run under one named mutex (`Local\lecter.spike.os-sandbox.setup`) so parallel launches don't race; the children still run in parallel. The Landlock rules are a pure `ruleset(abi)` function tested per ABI against uapi landlock.h.
- Why: parallel tests on a fresh Windows runner failed with 0x8007000a / ERROR_FILE_NOT_FOUND while another process was creating the shared profile (run 41504019480); the earlier green run won the race by luck.
- Instead of: one AppContainer profile per run (races the read-modify-write on the shared exe DACL and weakens the "earlier run, same container" test); running the tests one at a time; the Windows lockdown token (failed with 0xC0000135); asserting win.ini stays readable (brittle).
- Revisit if: the parse-worker port (F-052..F-054) creates the profile and exe ACE once at install or first start instead of taking the lock (spikes/os-sandbox/README.md requirement 10).

## D-149 · F-029's idle CPU measurement moves to F-025
2026-11-02 · orchestrator, decider: maintainer · active
- Decision: F-029 merges with criterion 5's redraw source recorded in its D-entry. The other half, idle CPU per process after the fix on ubuntu-24.04, is measured by F-025's open-idle run when F-025 lands, and recorded in the same F-029 D-entry.
- Why: F-025 depends on F-029, and its perf run stops at its own self-check until D-146's per-OS targets are applied (CI run 41521347359: `('lt', 150) != ('lt', 460.0)`), so F-029 can't take the measurement first.
- Instead of: measuring on the author's Fedora machine (not the named runner, and hardware rendering); blocking F-029 until planning breaks the loop.
- Revisit if: F-025's open-idle run shows idle CPU still above its budget; the redraw then has a second source.

## D-150 · Idle redraw: a finite caret blink, and block widgets without vertical margins (F-029)
2026-11-03 · F-029 builder, recorded by the orchestrator · active
- Decision: the idle redraw source was CodeMirror's `steps(1) cm-blink 1.2s infinite` CSS animation on the focused caret layer. caret.ts turns that off (`animation: none !important`) and runs one Web Animation per caret layer (1.2 s cycle for 10 s, no fill), replayed on keydown, mousedown, cursor moves and focus. Under prefers-reduced-motion the caret stays solid and never blinks. `.slide-heading` spacing moved from margin into padding (same look), because CodeMirror's height map ignores block-widget margins, so clicks below a heading landed about 36 px (one line or more) too low. The e2e flow clicks with an in-page single click (pointer and mouse events, detail 1) aimed at a measured character of the target line.
- Why: real WebKitGTK (author's run on b870703): animations end 10004–10011 ms after the last input, 0 running at 10 s, 0 mutations and 0 frame callbacks over 30.0 s, solid caret; CI run 41561874349 (fac10d7) green on Linux, macOS and Windows. tauri-plugin-wdio-webdriver 1.5.0's element click is a lone `el.click()` (no mousedown) and its pointer actions send detail 0, which CodeMirror reads as a triple click (line selected, Vim leaves normal mode).
- Instead of: a 10 s timer toggling a class (a DOM mutation inside the idle window); toggling CodeMirror's blink names; compensating for the heading margin in the test; WebDriver element click or pointer actions in the flow.
- Revisit if: F-025's open-idle run (D-149) shows idle CPU still above budget; or gloss/figure widgets keep vertical margins (same click offset, see PROGRESS Watch out).

## D-151 · New IPC command `app_mark_startup` for startup paint phases (F-179)
2026-11-03 · orchestrator, decider: maintainer · active
- Decision: the IPC contract gains `app_mark_startup(paint: "shell_first_paint" | "buffer_first_paint")` in the app row of 18-contracts.md#ipc. The UI calls it after its first shell paint and its first buffer paint; the core timestamps the call on arrival and logs `startup <phase> <ms>` once per phase. It is a closed enum argument, changes no state, and has one capability permission (`allow-app-mark-startup`).
- Why: F-179 criterion 1 needs the app itself to log every startup phase, and only the UI knows when it painted; events and plugin permissions aren't allowed (security review: sound, idempotent, no log spam).
- Instead of: measuring paint phases only in the e2e flow (criterion 1 would need rewording).
- Revisit if: startup logging moves to a tracing span the UI can emit through an existing command.

## D-152 · cold_open_ms gets per-OS targets, measured as the median of 5 launches (F-179)
2026-11-03 · orchestrator, decider: maintainer · active
- Decision: cold_open_ms gets per-OS targets (`per_os`), as the memory budgets did in D-146. Each OS's target is the first release-build measurement on its CI runner (ubuntu-24.04, macos-15, windows-2025) plus 10 %, rounded up to the next 10 ms. A measurement is the median of 5 launches of the e2e-app `cold-open` flow on a quiet machine. Targets only go down afterwards. The Linux target comes from F-179's branch run. macOS and Windows targets come from F-025's dispatch run, together with its memory targets. Until an OS has a target, the flow prints REPORT for that OS. The median is gated at ×1 against the OS's target, locally and with --ci, as the memory budgets are. The median of 5 and the 10 % margin take the place of the ×1.5 allowance and its re-measure.
- Why: the maintainer's machine shows the lecture about 400 ms after launch: frame 330–385 ms over 10 launches without the harness, plus a 63 ms open. About 300 ms of that is process and WebKit start-up before the page loads, which the app can't shorten (F-179 traced it, and an existing profile changed nothing). Single launches inside the harness measured 484 and 575 ms, so a one-run 400 ms gate failed most of the time without measuring Lecter.
- Instead of: timing from window creation (leaves the ~125 ms before the window ungated); keeping 400 ms and blocking F-179 (cold_open_ms would stay PENDING and fail when M0.5 finishes); another profiling round (uncertain gain).
- Revisit if: a Tauri or WebKitGTK upgrade shortens start-up (then tighten to the new measurement).

## D-153 · Cold-open startup breakdown before and after F-179 (ubuntu-24.04)
2026-11-03 · orchestrator (F-179) · active
- Decision: F-179 criterion 1's breakdown, with the release build plus test-hooks on ubuntu-24.04 under Xvfb.
  - Before: D-139 (CI run 41361813736) measured cold_open_ms 2906, then 973 on the re-measure. That build logged no startup phases, so there's no per-phase breakdown for it.
  - After (CI run 41588635437, ae74039): median 973 over 5 launches (960–981). Per launch: window created 126–140 ms, page load started 716–741, shell first paint 757–785, then open 195–216 (lecture in the DOM 120–171). The Linux target is 1080 ms (D-152).
  - Maintainer's machine (local, release build plus test-hooks): median 442 over 5 launches (407–462; one outlier at 2116 that stalled 1.7 s painting after the lecture was in the DOM). Without the harness, shell first paint was 310–385 ms over 20 launches. The test plugin adds about 15 ms, and reusing a profile changes nothing.
  - What F-179 changed:
    - The CodeMirror/Vim code moved into a lazy chunk, loaded after the shell paints. The entry chunk went from 144.04 to 10.71 KB gz.
    - The editor is pre-warmed after the first paint. On the maintainer's machine, "lecture in the DOM" went from 68 to 41–56 ms.
    - The app logs `startup <phase> <ms>` from the process start time in procfs.
  - On CI, about 590 ms of the 973 falls between window creation and page load start. That is WebKitGTK starting its web and network processes under software rendering, which the app can't shorten.
- Why: criterion 1 asks for the before and after breakdown in a D-entry. CI hides a passing job's output, so the flow writes its lines to the job summary.
- Instead of: a before run on a measurement branch (the startup lines didn't exist before this card).

## D-154 · e2e-app: no focus-check waits, parallel shards
2026-11-03 · maintainer (CI speed, branch chore/ci-e2e-speed) · active
- Decision: three changes to the real-app CI job, with no flow, assertion, timeout a test needs, or budget dropped or loosened.
  - The 5 s stall: @wdio/tauri-service 1.5.0 checks window focus before every find, `$`, `$$`, click and getTitle by evaluating `window.__wdio_original_core__`, which only its own tauri-plugin-wdio defines (the app embeds tauri-plugin-wdio-webdriver), so each check waited 5 s. The service skips the check for a session that made an explicit `switchToWindow` (its `afterCommand` adds the session to `userSwitchedWindowCache`). wdio.conf.ts `before` now switches to the current window once per session (tests/e2e/support/window.ts); restart.ts repeats it after its `reloadSession`, and its 300 s suite timeout is back to the 120 s default. Stalls per run: 0 on all three OSes (the old local idle run had 20; ime.ts already switched, which is why it was 9 s before and after).
  - Shards: new job `e2e-app-shard` (os × shard 1..3, `E2E_APP_SHARDS`), each with its own runner, build and app, running `scripts/verify.sh --stage e2e-app` with `LECTER_E2E_SHARD=<i>/3`. tests/e2e/support/shards.ts reads the flows from disk and balances them by measured seconds (longest first to the lightest shard; a flow with no time counts as the slowest), so every flow runs exactly once. Linux shard 1 is cold-open alone (D-152's quiet machine). `e2e-app (<os>)` keeps the status-check name (16-ci-cd.md rule 4): it needs the shards, runs unless the run was cancelled, and passes only when all 3 shards of its OS succeeded (scripts/e2e_app_gate.py over the run's jobs, `actions: read`). The shards are not status checks. `scripts/e2e-app.sh` with no flow still runs every flow; it also takes several flow names.
  - Caches: the Rust cache is keyed on the job id, and a branch run reads only its branch's caches and main's. e2e-app never runs on main on macOS and Windows, so their dispatch runs always started cold (`init.sh` 4.7 min on macOS, 6.7 on Windows). Their shards now use the `test` job's cache (setup `rust-shared-key: test`), which main saves; Linux shards keep `e2e-app`, and Linux shard 1 gets `e2e-app-cold-open` for cold-open's release build in target/perf. The pnpm store and PDFium caches already hit on every OS.
  - Every e2e-app shard writes each flow's seconds and focus-check stalls to the job summary and uploads `.verify/` (with timings.json) on every run, for 14 days.
- Measured (wall clock per job, minutes; runs on ubuntu-24.04, macos-15, windows-2025):
  - Before (main run 41632447433, dispatch 41588635437, baseline 41671342071 at cb923d2): e2e-app ubuntu 27.4 / 26.4 / 27.2, macOS 23.2 / 29.0, Windows 25.2 / 28.2. Per flow on Linux (s, baseline): buffer 193, cold-open 268, figure 100, find 147, gloss 121, idle 229, ime 9, open-course 137, open-folder 22, restart 225, shell 62.
  - Stall fix only (41671347855): ubuntu 9.6, macOS 11.6, Windows 14.5. Per flow on Linux (s): buffer 2, cold-open 271 (261 of it the release build), figure 10, find 2, gloss 11, idle 129, ime 9, open-course 2, open-folder 1, restart 4, shell 2; macOS and Windows within 1-4 s of these, idle 129-131.
  - Shards, dispatch (41674973425, Linux shard 1 cache still cold): shards ubuntu 8.5 / 4.2 / 3.5, macOS 5.1 / 3.1 / 3.7, Windows 7.6 / 6.5 / 4.2, gates 0.1-0.2; whole run 8.9 min.
  - Shards, pull_request (41675016954, Linux only, the push layout): first attempt with no caches for its ref 10.9 / 4.0 / 2.6, whole run 11.3 min; re-run with its caches 3.9 / 4.7 / 2.9, jobs spanning 5.2 min.
  - Debug test-hooks build per shard: Linux 9-14 s from the e2e-app cache (62-82 s cold), macOS 68-85 s and Windows 64-108 s from the borrowed test cache.
- Why: the stall was ~95% of the flows' time, and after it e2e-app was still one serial job of idle (~130 s, three 40 s windows that stay), cold-open's release build and per-OS build time. Shards put idle and cold-open beside the rest; per-shard builds cost 9-14 s on Linux.
- Instead of: building the app once per OS and handing it to the shards as an artifact (built, then removed unrun: it puts a whole job, an upload and a download before every shard, against a 9-14 s Linux build and about 1-2 min per shard on macOS/Windows that runs in parallel anyway); one shard per flow (idle and cold-open set the floor, and macOS allows 5 concurrent jobs); dropping or moving flows to nightly (not needed: under 10 min).
- Revisit if: Linux shard 1 stays slow after the first push to main (that push is cold, ~11 min: main has no `e2e-app-cold-open` cache yet, so init.sh's workspace build and both app builds start from nothing; later pushes restore it, and a push that changes Rust code rebuilds the workspace crates in release, between the 3.9 min re-run and that); a flow's time moves a lot (refresh `SECONDS` in shards.ts from timings.json); or cold_open_ms keeps failing on CI (Linux medians 1082, 1071, 953, 1072 against 1080 in these runs; Q-023).

## D-155 · cold_open_ms gates on the maintainer's machine, REPORT on CI
2026-11-03 · orchestrator, decider: maintainer (Q-023) · active
- Decision: budgets.sh gates the real-app cold_open_ms locally at each milestone gate, against a target from the maintainer's machine (median of 5 launches + 10 %); with --ci it prints REPORT, as keystroke_p99_ms does (D-146). 14-quality#performance-budgets and F-025's criteria change in the planning session together with D-152's wording.
- Why: CI runners are GPU-less VMs; about 590 ms of the 973 ms Linux CI median is WebKitGTK starting under software rendering, so the 1080 ms CI target catches regressions but can't hold the spec's 400 ms goal. Locally a lecture shows in ~385 ms standalone, 442 ms median inside the harness.
- Instead of: a flat local 400 ms target (fails today inside the harness); keeping D-152's CI gate as the only gate.
- Revisit if: a CI runner with hardware rendering becomes available.


## D-156 · Two cold_open_ms targets: CI regression net and the maintainer's local gate
2026-11-03 · orchestrator, decider: maintainer · active
- Decision: the e2e-app `cold-open` flow (F-179) keeps gating on CI at D-152's per-OS runner targets (Linux 1080 ms; macOS/Windows from F-025's dispatch run) as a regression net on every push; `budgets.json` `per_os` for cold_open_ms holds those. The local gate of D-155 uses a separate target from the maintainer's machine (median of 5 + 10 %), applied by budgets.sh without --ci at each milestone gate; budgets.sh --ci prints REPORT for the real-app value, as 14-quality says.
- Why: 14-quality's "gates only locally" read alone would leave cold open unguarded between milestone gates; the CI flow already catches startup regressions.
- Instead of: making the CI flow REPORT only (no per-push guard; needs a new card for F-179's flow).
- Revisit if: the Linux CI median keeps failing near 1080 ms on slow runners (Q-023 context), or a CI runner gets hardware rendering.

## D-157 · Figure-frame filter: sentinel-armed, a content rule list on WebKit, URL checks on WebView2 (F-028)
2026-11-03 · F-028 builder, recorded by the orchestrator · active
- Decision: a test-hooks plugin (app/src/figure_filter/plugin.rs) cancels a sentinel navigation `<loopback>/__lecter-test/figure-filter?figure=…&page=…&next=…`, arms the filter, then loads `next?ff-filter=armed`. On WebKitGTK and WKWebView the filter is a content rule list that blocks every `load-context: child-frame` load, then lets `^data:` and each figure origin through (ignore-previous-rules). On WebView2 it's WebResourceRequested on `*` for all contexts and source kinds, checked by URL only: a refused request gets a 403 made in the app, and the page's own origins pass for frames too.
- Why: the harness page can't use IPC and its ports are dynamic; the rule list is scoped to frames and blocked 16/16 vectors on its own on both WebKits; WebView2 can't tell which frame a request came from, and Referer/Sec-Fetch aren't reliably visible.
- Instead of: a test IPC command (touches the contract, bindings and capabilities); scheme-handler checks on WebKit (can't see http); header heuristics on WebView2.
- Revisit if: F-141 ships the filter for real lecter-fig:/lecter-lib: frames.

## D-158 · Figure frames need the CSP and the native filter together (F-028)
2026-11-03 · F-028 builder, recorded by the orchestrator · active
- Decision: F-141 keeps both guards. Root cause of D-142: Chromium checks `<link rel=prefetch>` against script-src, not default-src, so with D-145's `script-src lecter-fig: lecter-lib:` a figure can prefetch only from the figure schemes. With the filter alone and no CSP, WebKit blocked 16/16 vectors, but WebView2 blocked 15/16: WebSocket bypasses WebResourceRequested and only connect-src stops it. CI run 41694556626: WebKitGTK, WKWebView and WebView2 each 77/77 with filter + CSP, all 16 vectors blocked in the fig and lib frames, prefetch included.
- Why: run 3's own-origin lines and local Chromium 156 show the prefetch rule; the bare-frame variant shows what each guard stops alone.
- Instead of: the filter alone (WebView2 WebSocket leak); the CSP alone (WebView2 prefetch leak before D-145's script-src).
- Revisit if: WebView2 exposes WebSocket requests to WebResourceRequested.

## D-159 · Busy figure frames: per-webview watchdog results (F-028)
2026-11-03 · F-028 builder, recorded by the orchestrator · active
- Decision: detection is the earlier of two legs. WebKitGTK and WKWebView run the frame on the parent's thread (parent gap ~5 s), so only the core-side eval heartbeat sees a busy loop: 1496 ms (WebKitGTK), 1498 ms (WKWebView). WebView2 runs the frame on its own thread, and the in-page ping leg sees it at 1548 ms (1.35–1.55 s across runs); idle pings answer within 15 ms everywhere (CI run 41694556626).
- Why: criterion 2 asks for detection within 2 s and a per-webview record; this backs D-145's core-side watchdog for F-142.
- Instead of: an in-page watchdog only (blind on WebKit, where the frame freezes the UI thread).
- Revisit if: WebKit moves cross-origin frames to their own process or thread.

## D-160 · F-028 dependencies
2026-11-03 · F-028 builder, recorded by the orchestrator · active
- Decision: `webkit2gtk` (Linux), `webview2-com` and `windows-core` (Windows), `objc2`, `objc2-foundation` and `block2` (macOS) added to lecter-app as optional, per-OS dependencies enabled only by `test-hooks`, at wry's versions (MIT; windows-core MIT OR Apache-2.0); 0 new crates in Cargo.lock.
- Why: Dep-Added trailers on F-028 commit 66b03d8; check_deps OK.
- Instead of: a WebKit web-process extension; raw COM vtables; the full windows crate; building NSStrings by hand.

## D-161 · Perf gate: memory counted by share, idle-redraw diagnosis then card, per-OS ttft and idle CPU
2026-11-03 · orchestrator, decider: maintainer (Q-024) · active
- Decision: (1) memory budgets count every process, Lecter's own included, by its proportional share (Linux PSS, macOS phys_footprint, Windows private working set); Linux targets stay 460/500 MB; macOS and Windows targets are re-derived the same way (measurement + 10 %, next 10 MB; the macOS 300-slide sample is taken after the settle); RSS of all stays an info line. Replaces D-146's "own processes by RSS". (2) F-025 first adds per-thread CPU time series and in-page rAF/MutationObserver/animation counters to the idle run; a new M0.5 card then fixes the idle redraw it finds, and F-025 depends on it. (3) macOS ttft_overhead_ms gets a per-OS target (measurement + 10 %) after checking the measure's one-frame quantisation; Windows idle_cpu_pct gets a per-OS target if the WebView2 baseline can't be cut. For the planning session: criterion 6 of F-025, 14-quality#performance-budgets, the new card.
- Why: F-025 IMPOSSIBLE (reviewer agreed): counting lecter-app by RSS adds ~76 MB of pages shared with the web processes (Linux 469/528 MB by the mixed rule, 393/447 all by share, matching D-139's numbers the targets came from); idle CPU fails on all OSes (Linux 3.7 %, macOS 2.7 %, Windows 0.39-0.57 % in WebView2 only); macOS ttft 31-39 / 30 ms in three of three runs.
- Instead of: keeping RSS for own processes and raising Linux targets; opening the redraw card without a known cause; moving idle_cpu_pct to a later milestone; REPORT-only on macOS/Windows CI.
- Revisit if: a runner with hardware rendering becomes available, or the redraw card shows the idle CPU is the webview's own baseline.

## D-162 · Idle redraw source: the webview's native caret (F-180)
2026-11-03 · F-180 builder, recorded by the orchestrator · active
- Decision: the redraw left after F-029 is the engine's native caret: CodeMirror's `caret-color: transparent` hides it, but WebKitGTK, WKWebView and WebView2 keep blinking and repainting it while the contenteditable is focused. Measured on CI (40 s phases, Linux / macOS / Windows %): editor focused 4.42 / 3.58 / 0.23; blurred 0.02 / 0.16 / 0.00; plain focused contenteditable div 4.70 / 4.32 / 0.23; same div contenteditable=false and focused 0.05 / 0.20 / 0.00. In-page rAF, mutation and animation counters were all 0.
- Why: the attribution runs separate the caret from every in-page source.
- Instead of: CSS `caret-animation: manual` alone (no effect in WebKit; kept for Chromium); changing GTK blink settings from Rust (Linux only, outside the card).
- Revisit if: an engine adds caret-animation support or stops blinking hidden carets.

## D-163 · Park the editor 9 s after the last input (F-180)
2026-11-03 · F-180 builder, recorded by the orchestrator · active
- Decision: in normal or visual mode, 9 s after the last key, click, focus or cursor move, EditorView.editable goes false; .cm-content keeps the focus (tabindex 0) and the selection is set again (removeAllRanges, then setBaseAndExtent with the same anchor and focus) because macOS re-checks the blink only on a selection change (1.57 → 0.16 %). A capture listener on keydown, mousedown, touchstart, dragenter and compositionstart makes it editable again before CodeMirror and Vim see the event. Insert mode never parks.
- Why: 9 s lets the parking frame end before the protected 10 s caret window (caret.test, idle flow); insert mode stays editable so the first key after a pause goes through the IME and dead keys.
- Instead of: removing the DOM selection (screen readers lose the caret); cloneRange (flips backward visual selections); parking in insert mode.
- Revisit if: screen readers announce the parked editor badly, or WebKit's insert-mode blink matters for battery.

## D-164 · Idle attribution runs on a release build in the idle flow (F-180)
2026-11-03 · F-180 builder, recorded by the orchestrator · active
- Decision: tests/e2e/flows/idle.ts reuses cold-open's release build and launch on all three OSes, samples per-process and per-thread CPU in a time series plus in-page counters, prints `idle-attribution`, and gates idle_cpu_pct < 0.5 % on Linux and macOS (×1), report-only on Windows (D-161).
- Why: debug builds and single totals hid the source; the series separates a settle burst from a steady redraw.
- Instead of: a separate perf job (F-025 owns budgets.sh).
- Revisit if: the idle shard's ~13-15 min becomes the CI bottleneck (give it its own shard or move it to perf).

## D-165 · Perf gate: first measurements and per-OS targets by share (F-025)
2026-11-03 · F-025 builder, recorded by the orchestrator · active
- Decision: tests/perf/budgets.json per_os memory targets come from dispatch run 41742947222 (release build, every process by share), measurement +10 % rounded up to the next 10 MB: macOS idle_rss_mb 80.39 → 90, rss_300_slides_mb 345.82 (after the 5 s settle) → 390; Windows 75.8 → 90, 150.88 → 170; Linux 460/500 as specced. macOS ttft_overhead_ms per_os 42 ms (38, the larger of 35/38, +10 %); Linux and Windows keep 20 ms. No Windows per_os idle_cpu_pct: F-180 cut the WebView2 baseline (D-164; CI 0.16-0.21 %).
- First measurements (green CI run 41762048574, 43dbd0d): Linux 413.24 / 451.41 MB, idle CPU 0.02 %, ttft 16 ms, cold_open 778 ms (REPORT); macOS 78.55 / 315.58 MB, 0.17 %, ttft 47 ms (passes through the --ci ×1.5 allowance); Windows 75.75 / 148.39 MB, 0.16 %, ttft 9.9 ms.
- ttft quantisation check: macOS waits 16-34 ms for a frame per ask against a 17 ms frame interval (at least one whole frame every time), Linux 1-14 ms, Windows < 1 ms; to-page is 6-27 ms everywhere. The macOS extra is one systematic WebKit frame, so the target includes it.
- Why: D-161's rule (measurement + 10 %, next 10 MB) applied to one counting method on all three OSes.
- Instead of: the earlier mixed-method targets (macOS 170/710, Windows 120/200 MB); subtracting the frame from macOS ttft.
- Revisit if: macOS ttft keeps rising (36, 44, 47 ms in later runs; Q-025), or run 41742947222's raw report is needed (it isn't saved in .evidence/F-025/).

## D-166 · Skeleton flow: parse via lecter-harness, headless twin in the harness tests (F-026)
2026-11-03 · F-026 builder, recorded by the orchestrator · active
- Decision: tests/e2e/flows/skeleton.ts turns the slide PDF into a lecture with `lecter-harness parse` (the real worker and PDFium), writing the blocks as a lecture .md per 03-lecture-files#body, and builds lecter-harness itself (`cargo build -p lecter-harness --locked`). The no-GUI path is crates/harness/tests/skeleton.rs, using lecter_core::save::Session for edit and restart. The flow cleans up its PDF, lecture, journal and index in `after` (shards share the course).
- Why: the app has no import command until F-061 and doesn't spawn the parse worker yet (D-113); e2e-app.sh builds only lecter-app; the harness has no edit command.
- Instead of: an app import IPC (out of paths, decides naming and on-disk format); editing e2e-app.sh; a new harness command.
- Revisit if: F-061 lands (switch the parse step to the in-app import, Q-027).

## D-167 · A trusted course opens all its files; only non-course files are guarded (Q-012)
2026-11-04 · maintainer · active
- Decision: when the user trusts a course folder, Lecter doesn't skip or refuse its files (links out of the folder included); the checks only keep non-course material that could harm the app (dotfiles such as `.lecter/` internals and other hidden files) from being treated as course content. The planning session updates D-106 / F-018 / F-033.
- Why: the user chose to trust the folder; refusing their own linked slides gives no way forward.
- Instead of: failing the whole open with E_NOT_TRUSTED (D-106), or skipping linked files.
- Revisit if: a later "import someone else's course" mode lands (maintainer's idea: scan untrusted course files for safety first).

## D-168 · Unkept glosses live until the lecture closes; closing asks first (Q-015)
2026-11-04 · maintainer · active
- Decision: every gloss, kept or unkept (stopped part-way included), stays in the lecture until the user closes it. Closing a lecture that has unkept glosses asks for confirmation that they will be deleted; with only kept glosses, it closes without asking. The planning session specs "kept" vs "unkept" (10-keymap's "on a draft: keep it") and the close flow.
- Why: the user decides what to keep; nothing is lost silently.
- Instead of: a `stopped` attribute on part-way glosses (Q-015's recommendation).
- Revisit if: users lose wanted glosses to the close prompt.

