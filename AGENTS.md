# Lecter: rules for every agent session

Lecter is an MIT, local-first desktop app (Tauri 2 + Rust core + SolidJS/CodeMirror UI) where students annotate lecture slides live with Vim keys and get AI "glosses". You build v0 from a written spec, one feature per session, with a fresh context each time. This file is always loaded, so it stays short: procedure is in `PROMPT.md`, detail in `docs/spec/`, folder `CLAUDE.md` files and skills.

## Where truth lives (in this order)

1. `docs/spec/*.md`: what to build. Read-only for you. Map: `docs/spec/00-overview.md`.
2. `docs/DECISIONS.md`: choices made during the build (D-NNN). They fill gaps in the spec; they never override it.
3. `docs/features.json`: the plan (EARS criteria, owned paths, evidence). Change it only through `scripts/feature.py`.
4. The code. If code and spec disagree, the spec wins. If the spec is wrong, ask (below); don't "fix" it in code.

Status files: `docs/PROGRESS.md` (what is built), `docs/DECISIONS.md` (why), `docs/QUESTIONS.md` (what Jay must answer later), and `## Learned` in the nearest folder `CLAUDE.md`.

## Commands

| Need | Command |
|---|---|
| Where are we, what's next | `python3 scripts/next.py` (`--list`, `--ready`) |
| The spec for one feature, nothing else | `python3 scripts/spec.py F-0NN` |
| Claim, finish, block, annotate | `python3 scripts/feature.py start/done/block/note F-0NN` |
| Check everything | `scripts/verify.sh` (`--quick` while iterating) |
| Evidence for a feature | `python3 scripts/evidence.py check F-0NN` |
| Add a dependency | `python3 scripts/add_dep.py` (never `cargo add` / `pnpm add`) |
| Run a live-provider command | `scripts/live.sh F-0NN -- <cmd>` (live spikes only; Jay approves each run) |
| Add a test of any kind | `docs/TESTING.md` |

## Hard rules

- **One feature per session.** Finish it, or leave it `in_progress` with a precise note and a WIP commit.
- **Done means** `docs/spec/14-quality.md#definition-of-done`. Nothing less, and `feature.py done` checks it.
- **Search before you write.** Grep before assuming something is missing. Duplicates are the most common failure in this kind of build.
- **No placeholders** in shipped code: no `todo!()`, `unimplemented!()`, stub returns, fake data, or `TODO` without an issue number.
- **Tests are the proof, and the checks are protected.** Never delete, skip or weaken a test, a budget or a threshold to get green (`14-quality.md#protected-checks`; the guard and the lint enforce it). If a criterion can't be met as written, report `IMPOSSIBLE` with evidence (`14-quality.md#when-the-criteria-cant-be-met`).
- **Stuck rule.** Two identical failures in a row, or about 30 minutes without progress: stop, commit, and report `BLOCKED` with the evidence.
- **Stay in scope.** The feature's criteria, cited spec and owned `paths` only. Nothing from `15-later.md`. Bugs elsewhere go into PROGRESS "Watch out".
- **Dependencies** follow `01-architecture.md#dependency-policy`.
- **Jay's private lecture files are confidential.** They live only in `tests/corpus/private/` (git-ignored). Use them for local tests and spikes. Never commit, copy out, bundle, quote or name them anywhere tracked; refer to them only by manifest id (`P-07`) and aggregate numbers. Samples and the tutorial use synthetic English text. `scripts/check_private.py` enforces this.
- **No real network in tests.** Providers are faked (`tests/fake-provider/`). Live calls run only through `scripts/live.sh`; keys never enter your session.
- **Untrusted input** (slide files, web pages, model output) is parsed defensively and never executed (`13-security.md`).
- **Design.** UI follows `docs/design/` (tokens, components, reference screenshots). No hard-coded colours.
- **Pushing:** only `main`, only with `LECTER_ALLOW_PUSH=1`, only after verify passes. A red `main` stops the line. Never tag, force-push or rewrite history.

## Asking vs deciding

When the spec is silent or ambiguous:

- **Reversible** (naming, internal structure, a swappable library): decide, record a D-entry (builders: in the report), continue.
- **Irreversible or user-facing** (file formats on disk, keybindings, defaults, privacy, cost): Jay decides. Interactive: ask him, recommended answer first, record a D-entry. Builder: report `NEEDS_JAY`. Headless: Q-entry with your recommendation, then build behind that default or block.

## Engineering standards

**Performance is a feature.** Budgets (`14-quality.md#performance-budgets`) gate CI from the walking skeleton on: no polling, nothing loaded until used, no UI-thread work that belongs in the core, bounded queues.

**Rust:** `thiserror` in libraries, `anyhow` only in binaries. `unwrap`/`expect` are denied outside tests. No blocking in async (`spawn_blocking`); long tasks honour a `CancellationToken`. `tracing` spans on hot paths; never log prompt, answer or note text. Crate edges follow `01-architecture.md#repository-layout` (`scripts/check_arch.py`).

**TypeScript and Solid:** `strict`, no `any`. IPC types come only from the generated bindings (`18-contracts.md#ipc`). Every action is reachable by mouse and by key.

**Files:** one concept per file; source files stay under 500 lines (`scripts/check_size.py`).

**Commits:** `F-0NN: <what changed>` (or `chore:` / `docs:`), one logical change each, after each green step.

## Context economy

- Read spec sections through `scripts/spec.py`, not whole files.
- Wide searches go to the Explore subagent; keep only its answer.
- Pipe long output (`| tail -n 40`, `-q`). `verify.sh` already prints only failures.
- `## Learned` lists hold facts that prevent a repeat mistake. One line each.

## Learned (project-wide; one line each; keep ≤ 20)

<!-- Area-specific lessons go in that folder's CLAUDE.md. -->
