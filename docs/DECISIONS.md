# Decisions

Choices made outside or on top of the spec. The spec wins over this file; this file wins over the code. Format and rules: `.claude/skills/handoff/SKILL.md`. Never delete an entry; supersede it.

## D-001 · Tauri 2 with a Rust core
2026-10-23 · Jay · active
- Decision: Desktop shell is Tauri 2 using the system webview; all heavy work in a Rust core (tokio).
- Why: Smallest memory and install size of the cross-platform options while keeping a web UI; Rust for latency and safety.
- Instead of: Electron (memory), native per-OS UIs (3× the work), Flutter.

## D-002 · Local-first, no Lecter server in v0
2026-10-23 · Jay · active
- Decision: Everything runs on the user's machine; users connect their own AI providers. No accounts, no telemetry.
- Why: Privacy, zero running cost, simplest security story. Cloud sync and hosted models are later (`15-later.md`).

## D-003 · MIT licence and a permissive-only dependency policy
2026-10-23 · Jay · active
- Decision: Lecter is MIT. Dependencies only MIT, Apache-2.0, BSD, ISC, Zlib, MPL-2.0 (and similar); enforced by cargo-deny.
- Why: Open source like opencode, with room for paid services later. Excludes AGPL MuPDF, hence PDFium.

## D-004 · Open source now, optional paid services later
2026-10-23 · Jay · active
- Decision: Build v0 with no billing code; keep a provider slot so a hosted "Lecter" provider can be added later.
- Revisit if: Jay starts the subscription plan.

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
2026-10-23 · Jay + Claude · active
- Decision: Format exactly as `03-lecture-files.md`: readable without Lecter, anchors by block id.

## D-008 · Settings are JSONC with a JSON Schema generated from Rust types
2026-10-23 · Claude (planning) · active
- Decision: `schemars` generates `settings.schema.json`; Settings window, `:set` and files all go through it.
- Why: One source of truth for validation, completion and the settings UI.

## D-009 · Image understanding uses the provider by default; local model is opt-in
2026-10-24 · Jay · active
- Decision: `parsing.vision = provider` by default; `local` (PaddleOCR-VL class, CPU-capable) and `auto` are options; text-layer slides need neither.
- Why: Jay: don't assume 16 GB RAM or a GPU; providers' vision is strong and cheap with a fast model.
- Revisit if: F-002 shows the local model wins on quality per cost on typical laptops.

## D-010 · Web search uses the provider's native tool by default, configurable at four levels
2026-10-24 · Jay · active
- Decision: Modes `native | service | off`; precedence prompt > role (gloss type) > course > global; AI harness settings page exposes all of it.
- Why: Jay wants results as close as possible to chatgpt.com and claude.ai; native tools are what those products use.

## D-011 · Local small embeddings by default; provider embeddings allowed if stored
2026-10-24 · Jay · active
- Decision: `index.embeddings = local-small` by default; `provider` allowed (vectors stored locally, never recomputed per query). Final default chosen by the F-003 eval.

## D-012 · No graph RAG in v0
2026-10-23 · Claude (research) · active
- Decision: Hybrid BM25 + vectors with RRF, plus tools; concept map built from section trees without extra LLM calls.
- Why: Graph RAG costs thousands of indexing calls and 37–70 s per query on course material; it wins only on broad thematic questions.
- Revisit if: revise and gap-finder quality is poor in the AI eval.

## D-013 · Feedback sharing: ratings and metadata opt-in; text is a second opt-in
2026-10-24 · default applied (Jay did not object) · active
- Decision: Both off unless chosen in onboarding; stored locally until `feedback.endpoint` exists.

## D-014 · Global config folder is ~/.config/lecter
2026-10-24 · Jay · active
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
- Why: Keep cold start and keystroke budgets reachable; honour Jay's "no GPU assumed".

## D-023 · Build process: spec-driven, one feature per fresh session
2026-10-24 · Claude (kit) · active
- Decision: Sessions follow PROMPT.md; features.json changes only through scripts/feature.py; spec edits only in planning sessions; hooks enforce it.
- Why: Fresh context per feature keeps quality high and tokens low; files carry memory between sessions.

## D-024 · Default models are picked at connect time from the catalog
2026-10-24 · Jay + Claude · active
- Decision: default-fast is the provider's fast tier (Gemini Flash, Claude Haiku, OpenAI's GPT Luna line, e.g. `gpt-6-luna` / `gpt-5.6-luna`), default-strong a Sonnet-class model or equal; the user can change both. No model ids hard-coded beyond catalog fallbacks.
- Why: Jay wants fast models by default; model names change faster than releases.

## D-025 · Repository is github.com/jaykuroor/lecter (public), trunk on main
2026-10-24 · Jay · active
- Decision: Public from day one (free CI on all three OSes). Default branch `main`; sessions push `main` after every verified feature; feature branches `feat/F-0NN-<slug>` merged with `--no-ff`; sessions push `main` only with `LECTER_ALLOW_PUSH=1`; never tag or force-push.

## D-026 · CI/CD as in 16-ci-cd.md
2026-10-24 · Claude (kit) · active
- Decision: ci.yml (lint, test on ubuntu-24.04/macos-15/windows-2025, e2e; perf from F-126), nightly.yml (full, fuzz, tauri-e2e, chaos, soak), release.yml on tags (tauri-action, signing optional, SBOM, draft release), dependabot weekly. `scripts/verify.sh --stage` is the only entry point.
- Why: The build machine is Fedora; CI is the only place macOS and Windows are exercised, and it stops one session from breaking another's work.
- Instead of: Separate CI logic in YAML (drifts from local checks); PR-per-feature with required checks (serialises builds behind 3-OS CI).
- Updated 2026-10-24 (kit rebuild): perf runs from the walking skeleton (F-025, D-044); ci.yml adds `e2e-app` (real app on 3 OSes) and `release-check`; nightly adds the perf matrix on 3 OSes; the lint stage adds the kit lints and gitleaks (16-ci-cd.md).

## D-027 · Orchestrated parallel builds
2026-10-24 · Claude (kit) · active
- Decision: An interactive orchestrator session (PROMPT.orchestrate.md) runs up to N background `builder` subagents, each in its own git worktree; it alone reviews, merges and writes shared state (PROGRESS, DECISIONS, QUESTIONS, CHANGELOG, README, features.json). The guard blocks shared-state edits inside worktrees.
- Why: Jay wants many agents working while he watches and answers questions in the Claude Code CLI; a single writer avoids merge conflicts on state files.
- Updated 2026-10-24 (kit rebuild): default N is 1 and a second builder needs non-overlapping owned paths (D-040, D-051); builders set up with `scripts/worktree_setup.sh`; a security reviewer joins the reviewer (D-039); the orchestrator stops at milestone gates (D-038).

## D-028 · Test tooling
2026-10-24 · Claude (kit) · superseded in part by D-049 (real-app e2e)
- Decision: cargo-nextest, proptest, insta (snapshots), criterion, cargo-fuzz; Vitest + @solidjs/testing-library; Playwright (chromium + webkit) against a mocked core; WebdriverIO + tauri-driver nightly; `tests/fake-provider` is a workspace crate `lecter-fake-provider` (library + binary). Conventions in docs/TESTING.md.

## D-029 · Version, changelog and dev entry points
2026-10-24 · Claude (kit) · active
- Decision: One version in Cargo `[workspace.package]`, `app/tauri.conf.json` and `ui/package.json` (checked by verify); Keep a Changelog with one line per merged feature; `scripts/dev.sh` runs the app in dev mode; `README.md` is the public face and its Roadmap status is updated when a milestone completes.

## D-030 · App identifier io.github.jaykuroor.lecter, built to be renamed
2026-10-24 · Jay · active
- Decision: Use `io.github.jaykuroor.lecter` until Jay owns a domain. Nothing durable depends on it: paths and keychain use the fixed name `lecter`, the webview stores nothing durable, Windows keeps a fixed WiX upgradeCode, and `identity::migrate()` handles `LEGACY_APP_IDS` (01-architecture.md#app-identity-and-migration).
- Why: Jay wants a real domain-based id later without breaking users' data or updates. `io.github.<user>.<app>` is also an accepted Flathub id pattern, so a rename may never be needed.

## D-031 · Live AI testing uses Gemini (API key) and OpenAI (ChatGPT sign-in)
2026-10-24 · Jay · active
- Decision: Live spikes and the AI eval use Gemini via `GEMINI_API_KEY`, and OpenAI through the app's own ChatGPT sign-in once F-055 exists (F-070 re-runs the comparisons). Anthropic and other adapters are tested only against the fake provider until Jay adds a key.
- Consequence: features marked `needs: ["live-keys"]` run only with `LECTER_LIVE_TESTS=1`.
- Updated 2026-10-24 (kit rebuild): keys live in `~/.config/lecter-dev/keys.env` and reach only commands run through `scripts/live.sh` (D-046), never the session environment. The ChatGPT sign-in is F-085; F-111 re-runs the comparisons. Gemini is the free tier (D-035).

## D-032 · Jay's lecture files are a private, local-only test corpus
2026-10-24 · Jay · active
- Decision: 25 real files (slides with and without annotations, dense text, fully handwritten notes) live in `tests/corpus/private/` with a manifest (ids P-01…P-25, kind guesses from text-layer stats). Confidential: never committed, bundled, quoted or named in tracked files. Enforced by .gitignore (all documents ignored outside fixtures/public corpus), scripts/check_private.py and the guard hook.

## D-033 · The tutorial teaches the app with synthetic English content
2026-10-24 · Jay · active
- Decision: "Lecter 101" sample course, one plain-English lecture about using Lecter, canned "Sample answer" glosses, works offline with no provider. No statistics demo, no real course material.

## D-034 · Two parallel builders by default
2026-10-24 · Jay · superseded by D-040
- Decision: `LECTER_PARALLEL=2` (Jay: 32 GB RAM, Claude Pro). Builders run as background subagents that Jay watches from the agent panel; agent teams (experimental, no resume, no worktree isolation) are not used.

## D-035 · Free-tier Gemini may receive slides; nothing is published
2026-10-24 · Jay · active
- Decision: Live spikes and the AI eval may send Jay's private slides to his free-tier Gemini key. Nothing from them is ever published or made public; the private-corpus rules (D-032) are unchanged.
- Consequence: live scripts rate-limit themselves (Gemini free-tier preset in `scripts/live.sh`: 8 requests/min, 200/day, 200k tokens/min by default), honour `retry-after`, back off with jitter, and save partial results (SEC-15). The app ships the same preset (SEC-10).

## D-036 · The concept demo becomes docs/design
2026-10-24 · Jay · active
- Decision: The look and interaction patterns of `lecter-concept-demo.html` become `docs/design/` (`tokens.json`, `components.md`, `reference/` crops). The demo palette is the bundled default "Lecter" theme and the fallback; GTK themes still win on Linux. None of the demo's course content is used; committed crops were sanitised.
- Consequence: UI features attach screenshots that the reviewer compares with the reference crops; per-OS baselines come with F-177 and only Jay approves baseline changes.

## D-037 · Local build inside the Claude Code sandbox
2026-10-24 · Jay · active
- Decision: Jay runs `claude` in the unzipped kit on his Fedora machine (no container or VM). `.claude/settings.json` turns on Claude Code's sandbox (bubblewrap + socat) with `failIfUnavailable`, a network allowlist (crates, npm, GitHub, Playwright, rustup), no unsandboxed retries, and denied reads of SSH, GPG, AWS, the second account's config and the live keys.
- Why: Agents run for hours with permission prompts mostly pre-approved; the sandbox bounds what a mistaken or injected command can reach.
- Revisit if: the dry run on Jay's machine finds a blocked essential step: narrow the allowlist (never disable the sandbox) and record a D-entry.

## D-038 · Milestone gates pause the build for Jay
2026-10-24 · Jay · active
- Decision: When a milestone's non-spike features are all done, `next.py` exits 5 and the orchestrator stops dispatching. It runs the security reviewer on the milestone, shows Jay a 5–10 minute checklist for `scripts/dev.sh` (`feature.py gate`, from each feature's `try` line), and waits. Jay's notes go to QUESTIONS → planning session → features. `feature.py gate M<n> --pass` records his go.

## D-039 · A security reviewer and the robustness basics
2026-10-24 · Jay · active
- Decision: `.claude/agents/security-reviewer.md` reviews every feature with `reviews: ["security"]` (parse worker, IPC or capabilities, keys, network, figure iframe, file writes, updater; 44 features) and each milestone, against a fixed checklist mapped to SEC-xx (13-security.md) and ROB-xx (17-robustness.md). Those specs now cover outbound rate limiting, spend caps, coalescing, timeouts, input limits, file watching, external edits, data versioning, file-system edge cases, secrets, logs, output handling, Tauri lockdown, processes, supply chain and provider drift.
- Why: these are what vibe-coded apps usually leave out (OWASP Top 10 for LLM Applications 2025, Tauri's capability model).

## D-040 · Quality over speed: one builder at a time, two Pro accounts
2026-10-24 · Jay · active
- Decision: `LECTER_PARALLEL` defaults to 1. Jay may opt into 2 only for features with non-overlapping owned paths (`next.py --ready --beside`). Jay alternates two Claude Pro accounts by hand: A (default) until its limit, then B (`alias claude-b='CLAUDE_CONFIG_DIR=~/.claude-b claude'`), then A after its reset. The orchestrator writes a resume point to PROGRESS before every dispatch and merge and recovers builders that died mid-step (stash, then resume the branch).
- Why: usage windows are the bottleneck; a second builder spends them twice as fast and adds merge conflicts. Holding two accounts is allowed; sharing or rotation tools are not, so switching is manual with the official commands.
- Instead of: D-034 (two builders by default).

## D-041 · Dependency approval policy
2026-10-24 · Jay · active
- Decision: Agents may add small pure-Rust or JS packages within the licence policy, with a `Dep-Added` trailer and a D-entry. Native code (ONNX Runtime, PDFium builds, C/C++ build scripts, system libraries), more than 30 new crates, or more than 100 KB gzipped to the UI need Jay first (`NEEDS_JAY`, then a `Deps-Approved: D-0NN` trailer). Single source: `01-architecture.md#dependency-policy`; enforced by `scripts/add_dep.py`, `scripts/check_deps.py` and the guard.

## D-042 · macOS is verified only in CI until Jay has a Mac
2026-10-24 · Jay · active
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
- Decision: Keys live in `~/.config/lecter-dev/keys.env` (mode 600). `scripts/live.sh F-0NN -- <cmd>` loads them into that one command, only for an in-progress feature with `needs: ["live-keys"]`, logs what ran, and Jay approves each run. The sandbox denies the file and the key variables to every other command; the guard and permission rules block reading it; SessionStart warns if a key is in the session environment.
- Why: the old guide exported keys before `claude`, so every builder inherited live mode (review bug 3).

## D-047 · Protected checks, the test-weakening lint and the IMPOSSIBLE outcome
2026-10-24 · Claude (kit) · active
- Decision: The guard blocks edits (and shell writes) to existing checks: verify.sh, budgets, thresholds, workflows, lint configs, snapshots and baselines, unless the in-progress feature lists the file under `protected`. `scripts/check_tests.py` fails a change that deletes or skips tests, adds retries, loosens budgets or thresholds, or changes snapshots, unless a `Test-Removed`, `Snapshot-Changed` or `Budget-Changed` (with Jay's D-entry) trailer explains it. A builder that can't meet a criterion reports `IMPOSSIBLE` with evidence.
- Why: research criterion 11; agents game checks they can edit, and an explicit way out cuts gaming sharply.

## D-048 · IPC contract generated with tauri-specta
2026-10-24 · Claude (kit) · active
- Decision: Commands and events are Rust types exported with tauri-specta (v2, the Tauri 2 line) to `ui/src/core/bindings.ts`; the mocked core implements the same types; `verify.sh` fails on stale bindings (F-017 pins the version in a D-entry). Spec: `18-contracts.md` (IPC, validation, error codes, worker protocol, `state.db` v1, journal format).
- Instead of: ts-rs plus hand-written invoke wrappers (two sources of truth), TauRPC (smaller community).

## D-049 · Real-app e2e with the embedded WebDriver plugin
2026-10-24 · Claude (kit) · active
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
- Decision: `scripts/secret_scan.sh` (gitleaks; old and new CLIs) runs in the lint stage (commits since the base, staged, unstaged and untracked files) and in the Stop hook (this session's commits). CI scans the full history. Findings stop the push; Jay rotates the secret.

## D-054 · Mechanical architecture and code-health rules
2026-10-24 · Claude (kit) · active
- Decision: `scripts/check_arch.py` enforces the crate-edge table, workspace lints (`unwrap_used`, `expect_used` denied) and `clippy.toml` disallowed blocking methods; `scripts/check_size.py` caps source files at 500 lines, spec files at 300 and AGENTS.md + CLAUDE.md at 150; jscpd and knip join the lint stage with F-014. The gardener runs every 6 features.

## D-055 · Native crates covered by the decided stack
2026-10-24 · Claude (kit) · active
- Decision: `scripts/deps_preapproved.txt` lists native crates that Jay's stack decisions already imply (Tauri's webview bindings, bundled SQLite, ring, compression, D-Bus for the keychain), so `check_deps.py` doesn't stop for them. Anything else native needs Jay (D-041). The file is a kit file only Jay edits.

## D-056 · Builder discipline: baseline first, stuck rule
2026-10-24 · Claude (kit) · active
- Decision: A builder runs `verify.sh --quick` before building (via `worktree_setup.sh`) and reports BLOCKED instead of building on a red `main`. After two identical failures or about 30 minutes without progress it commits and reports BLOCKED with evidence.

## D-057 · Sandbox fixes from the kit dry run
2026-10-24 · Claude (kit) · active
- Decision: Changes from running the kit in a real sandboxed Claude Code session. `init.sh` creates the sandbox's write folders and, if it can't, prints the `mkdir -p` line to run outside, because the sandbox only grants writes to folders that already exist. `.gitignore` ignores the placeholders the sandbox mounts over root dotfiles and Claude Code's own `.claude/` folders (only `settings.json`, `agents/` and `skills/` are tracked there), because they break `git add -A` mid-session. The allowlist accepts each script both as `scripts/x.py` and as `python3 scripts/x.py`. `init.sh` and `verify.sh` point pnpm at `HTTPS_PROXY`, because pnpm prefers inherited `npm_config_*` proxy settings that the sandbox doesn't replace. `init.sh` passes `--silent` to pnpm rather than to the build script, installs Playwright's Chromium (unless `PLAYWRIGHT_BROWSERS_PATH` is set), and `verify.sh` runs biome with `--colors=off` so failure lines stay readable.
