# Open and later questions

Questions that can't be answered right now. In interactive sessions, agents ask the maintainer directly and record the answer in `docs/DECISIONS.md`. This file holds only:
- **open**: raised during a headless run; the maintainer answers on the `Answer:` line, and the next planning session applies it;
- **later**: things the maintainer will decide when the time comes. Don't block on these; they name the feature that needs them.
- **Gate notes**: what the maintainer noticed while trying a milestone; the next planning session turns them into features.

Format: `.claude/skills/handoff/SKILL.md`.

## Q-001 · later · blocks: F-171
Who provides code-signing credentials (Apple Developer ID for signing and notarisation, a Windows code-signing certificate), and as which GitHub secrets?
- Context: release.yml builds unsigned packages without them (16-ci-cd.md). Unsigned builds trigger Gatekeeper and SmartScreen warnings.
- Recommended: ship unsigned pre-releases until v0 is feature-complete, then add the secrets before the first public release (applied as default: yes).
- Answer:

## Q-002 · later · blocks: F-172
Generate the Tauri updater signing key pair and store the private key as the `TAURI_SIGNING_PRIVATE_KEY` repository secret?
- Context: The maintainer must run `pnpm tauri signer generate` themselves and keep the private key off the repository; the public key goes into `app/tauri.conf.json`.
- Recommended: do it when F-172 starts (applied as default: no).
- Answer:

## Q-003 · later · blocks: nothing
Where should opted-in feedback be sent (`feedback.endpoint`)?
- Context: v0 stores opted-in ratings locally until an endpoint exists (D-013).
- Recommended: decide when the paid or hosted services start (15-later.md).
- Answer:

## Q-004 · later · blocks: first public release (F-170)
Run the hands-on Mac checklist on a real Mac before the first public release?
- Context: macOS is verified only in CI until the maintainer has a Mac (D-042). CI can't judge feel, gestures, menus, notarisation prompts or WKWebView quirks.
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
- Context: the maintainer decided at the F-001 stack call (D-080, D-081) that performance settings default to Balanced and are user-configurable. A Performance / Balanced / Quality preset goes in Settings > Performance and `:set`. Quality shows a lag warning. Build sessions can't add acceptance criteria.
- Recommendation: in the planning session (`scripts/loop.sh plan`), add the preset to the settings schema (F-030), the settings window (F-045) and the `:set` command, and to the editor-surface feature: idle-time Markdown highlighting in Balanced, lazy KaTeX, live in Quality. Add the "performance toggles default to Balanced" rule to the settings spec.

## Q-007 · planning · blocks: nothing
Mention spike crates in the 01-architecture crate table (D-082).
- Context: check_arch.py now allows `lecter-spike-*` crates under `spikes/` with no Lecter dependencies (D-082, applied by the author). The spec table doesn't mention them yet.
- Recommendation: add one line under the 01-architecture crate table: "Spike crates (`spikes/*`, `lecter-spike-*`) are throwaway, may depend on no Lecter crate, and are never depended on."

## Q-008 · planning · blocks: F-005
Windows parse-worker sandbox: accept the LPAC boundary in SEC-01, or require more?
- Context: F-005 criterion 1 says the sandboxed child can't "read a file other than its input". On Windows (LPAC AppContainer + job object), CI run 40154388308 passes 55/56. The child can still read `%SystemRoot%\win.ini` through the inherited `(A;ID;0x1200a9;;;S-1-15-2-2)` grant (ALL RESTRICTED APPLICATION PACKAGES, read/execute), which LPAC honours by design. One attempt with a Chromium-style lockdown token (30934ba, run 40153640323) fails at start-up (0xC0000135). The reviewer agreed with IMPOSSIBLE. Evidence: `.evidence/F-005/windows-ci.log`, the spike README, D-083.
- Recommendation: change SEC-01 for Windows to: "Windows: LPAC AppContainer + job object. Besides its input (passed as a handle), the worker can read only files whose ACL grants ALL RESTRICTED APPLICATION PACKAGES read/execute (OS and installed program files). Files without that grant, including everything under the user profile, are denied." Keep the rest of SEC-01 (no network, 1 GB, one process). Then update F-005's system-file test to match (for example, a file under the user profile must be denied) and merge the branch. If OS files must be denied too, add a separate parse-worker feature that retries the lockdown token from 30934ba and solves start-up DLL loading.

## Q-009 · planning · blocks: the first shipping crate that loads PDFium
Add a pinned PDFium CI setup step, so tests stop downloading (D-086).
- Context: F-006's spike tests download PDFium (~25 MB, SHA-256-checked) on every fresh CI runner, as an exception to the no-network rule (D-086).
- Recommendation: a CI step (and an init.sh step locally) that runs `fetch_pdfium.py` with an `actions/cache` keyed on `pins.json`. Tests then only read the verified local file, and are offline. Make it part of the parse crate's feature or a small CI feature.

## Q-010 · planning · blocks: editor work in M1 (D-080)
Which card runs the real-app WebKitGTK keystroke p99 trace and memory check that D-080 calls its deciding check?
- Context: D-080 gave the trace to F-016, but F-016's criteria never included it, and F-016 shipped without it. The WebDriver setup it needs now exists (`scripts/e2e-app.sh`). It can't run in the Claude sandbox, so the author runs it.
- Recommended: a small M0.5 card. It adds an `editor-keystroke` e2e-app flow that types into CodeMirror in the real app, records keystroke p99 and the webview process RSS, and the author runs it outside the sandbox before any M1 editor feature starts. (applied as default: no)
- Answer: yes, as part of F-019 (D-108, maintainer 2026-10-25).

## Q-011 · planning · blocks: nothing
Change F-016's verify line `scripts/check_release_binary.sh` to `tests/e2e/release-check.sh`?
- Context: check_release_binary.sh needs the release binary's path and exits with an error without one. release-check.sh builds release and debug, then asserts pass and fail (criterion 6). `feature.py set` only works on todo/blocked cards.
- Recommended: yes, in the planning session. (applied as default: no)
- Answer:

## Q-012 · planning · blocks: nothing
Should a course whose slides/ links to files outside it (e.g. ~/Downloads) open with those files skipped, instead of failing with E_NOT_TRUSTED?
- Context: F-018 fails the whole open (D-106). Students may keep slides elsewhere and link them in; the failure names the entry but gives no way forward.
- Recommended: keep the failure until F-033's trust screen can explain it and offer to include them. (applied as default: yes)
- Answer:

## Gate notes
<!-- The orchestrator appends the maintainer's notes from each milestone gate here, as "### M<n> (date)" plus their words. PROMPT.plan.md turns them into features. -->
