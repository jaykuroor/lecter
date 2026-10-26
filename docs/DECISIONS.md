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
2026-10-23 · maintainer (Node) + session F-010 · active
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
2026-10-23 · maintainer · active
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
