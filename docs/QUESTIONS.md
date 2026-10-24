# Open and later questions

Questions that can't be answered right now. In interactive sessions, agents ask Jay directly and record the answer in `docs/DECISIONS.md`. This file holds only:
- **open**: raised during a headless run; Jay answers on the `Answer:` line, and the next planning session applies it;
- **later**: things Jay will decide when the time comes. Don't block on these; they name the feature that needs them.
- **Gate notes**: what Jay noticed while trying a milestone; the next planning session turns them into features.

Format: `.claude/skills/handoff/SKILL.md`.

## Q-001 · later · blocks: F-171
Who provides code-signing credentials (Apple Developer ID for signing and notarisation, a Windows code-signing certificate), and as which GitHub secrets?
- Context: release.yml builds unsigned packages without them (16-ci-cd.md). Unsigned builds trigger Gatekeeper and SmartScreen warnings.
- Recommended: ship unsigned pre-releases until v0 is feature-complete, then add the secrets before the first public release (applied as default: yes).
- Answer:

## Q-002 · later · blocks: F-172
Generate the Tauri updater signing key pair and store the private key as the `TAURI_SIGNING_PRIVATE_KEY` repository secret?
- Context: Jay must run `pnpm tauri signer generate` himself and keep the private key off the repository; the public key goes into `app/tauri.conf.json`.
- Recommended: do it when F-172 starts (applied as default: no).
- Answer:

## Q-003 · later · blocks: nothing
Where should opted-in feedback be sent (`feedback.endpoint`)?
- Context: v0 stores opted-in ratings locally until an endpoint exists (D-013).
- Recommended: decide when the paid or hosted services start (15-later.md).
- Answer:

## Q-004 · later · blocks: first public release (F-170)
Run the hands-on Mac checklist on a real Mac before the first public release?
- Context: macOS is verified only in CI until Jay has a Mac (D-042). CI can't judge feel, gestures, menus, notarisation prompts or WKWebView quirks.
- Checklist (30 minutes, Apple Silicon and, if possible, Intel):
  1. Install the `.dmg`; first launch shows no Gatekeeper error (signed and notarised) or the expected unsigned-preview warning.
  2. Onboarding, Lecter 101 tutorial, then open a real course folder from iCloud Drive and from a local folder.
  3. Vim keys, IME (Japanese or Chinese input) and dead keys in the lecture buffer; Cmd shortcuts don't clash with Vim.
  4. System light/dark switch while open; the bundled Lecter theme follows it.
  5. Keychain prompt wording when adding a provider key; sign in with ChatGPT.
  6. Ask, step, define and park a doubt: glosses stream smoothly (no stutter while typing).
  7. Interactive figure: opens, stops when hidden, no network in the frame.
  8. Quit during a stream and reopen: nothing lost; Activity Monitor shows no leftover worker process.
  9. Idle RAM and CPU in Activity Monitor are within `14-quality.md#performance-budgets`.
  10. In-app update from the previous version.
- Recommended: borrow a Mac for one session before tagging v0.1.0 (applied as default: no).
- Answer:

## Q-005 · answered · blocks: nothing
M0 security review: CI installs fall back to unlocked when lockfiles don't match. Make them strict in CI?
- Context: `scripts/init.sh:84` (`cargo fetch --locked … || cargo fetch`) and `:88` (`pnpm install --frozen-lockfile … || pnpm install`) fall back to unlocked installs. Since F-013, CI's setup action runs init.sh, so a PR whose manifests don't match the committed lockfiles gets them rewritten in the runner, resolves new versions from `^` ranges and goes green; verify.sh's `--locked` then checks against the rewritten lockfile (SEC-50).
- Recommendation: when `CI` is set, run only `cargo fetch --locked` and `pnpm install --frozen-lockfile`, with no fallback, and add a test in crates/harness/tests/ci.rs. Keep the fallback for local runs. Small CI fix (owner: scripts/init.sh, F-013's path).
- Answer: the author, at the M0 gate: fix it now, before passing the gate. Done in CI-4ec6f29 (D-078).

## Q-006 · planning · blocks: F-030, F-045
Add the performance presets (D-081) to the spec and the features.
- Context: Jay decided at the F-001 stack call (D-080, D-081) that performance settings default to Balanced and are user-configurable. A Performance / Balanced / Quality preset goes in Settings > Performance and `:set`. Quality shows a lag warning. Build sessions can't add acceptance criteria.
- Recommendation: in the planning session (`scripts/loop.sh plan`), add the preset to the settings schema (F-030), the settings window (F-045) and the `:set` command, and to the editor-surface feature: idle-time Markdown highlighting in Balanced, lazy KaTeX, live in Quality. Add the "performance toggles default to Balanced" rule to the settings spec.

## Gate notes
<!-- The orchestrator appends Jay's notes from each milestone gate here, as "### M<n> (date)" plus his words. PROMPT.plan.md turns them into features. -->
