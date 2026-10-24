You are one session in a long build of Lecter v0. Earlier sessions left their state in files; later sessions will rely on what you leave. Build exactly one feature well, prove it, hand off, stop.

## 1 · Orient (no exploring yet)

- The SessionStart hook already printed `== Lecter build state ==` and a `NEXT` or `RESUME` card. If you don't see it, run `python3 scripts/next.py`.
- `ALL DONE`: run `scripts/verify.sh --full`, write a final PROGRESS entry, commit, and stop.
- `ALL REMAINING BLOCKED`: in an interactive session, ask Jay what unblocks them. Otherwise make sure each blocker has a Q-entry in `docs/QUESTIONS.md`. Commit, and stop.
- `RESUME`: a previous session ran out of room. Read its note on the card and the top of `docs/PROGRESS.md`, check `git log -3 --stat`, and continue from there.
- `MILESTONE GATE`: stop. Jay tries the app first (`python3 scripts/feature.py gate` prints his checklist). In an interactive session, show it to him and wait for his go.
- `NEXT`: if the card says "Ask Jay before building", ask (interactive) or block with a Q-entry (headless). Otherwise run `scripts/verify.sh --quick` (if `main` is already red, fix that first as a `chore:` or block), then `python3 scripts/feature.py start F-0NN`.

## 2 · Load only what this feature needs

1. `python3 scripts/spec.py F-0NN` gives the cited spec sections. Follow a cross-reference only if a criterion depends on it.
2. `grep -n "F-0NN\|<key terms>" docs/DECISIONS.md` finds earlier choices that constrain you.
3. Find what already exists before planning. Use the Explore subagent for anything wider than one folder ("is there already a parser for X", "where are settings read"). Never assume code is missing.
4. Write a short task list: criteria → tests → implementation steps.

## 3 · Tests first

For each acceptance criterion, write the test that proves it, in the layer the criterion implies:

- unit or property in the crate;
- `vitest` for UI logic;
- Playwright (mocked core) for anything the user sees or presses, and WebdriverIO on the real app where the criterion needs the real core (`drive-app` skill);
- `lecter-harness` for core behaviour you can check without a GUI.

Run them and watch them fail for the right reason; save that failing run as evidence (`.evidence/F-0NN/`). For a spike (`kind: spike`), the "test" is a reproducible measurement script under `spikes/<name>/`, and the result goes in `docs/DECISIONS.md`.

## 4 · Implement

- Make the smallest complete change that satisfies the criteria and the cited spec. Match existing patterns in the folder. Its `CLAUDE.md` loads automatically and lists the invariants.
- No placeholders, no "for now" shortcuts, no commented-out code. If something can't be finished, stop and go to step 7 with the feature left `in_progress`.
- Run `scripts/verify.sh --quick` (or the narrower command from the `verify` skill) after each meaningful step. Commit each green step: `F-0NN: <step>`.
- Hit a gap in the spec? Use the rule in AGENTS.md: decide if it's reversible, ask if it isn't.
- A criterion that can't be met as written: stop and report `IMPOSSIBLE` (`docs/spec/14-quality.md#when-the-criteria-cant-be-met`). Never bend a test or a protected check.
- Stuck (two identical failures, or ~30 minutes without progress): commit, `feature.py block` with the evidence, stop.

## 5 · Prove it

1. Run `scripts/verify.sh` (the full default set) until it prints `VERIFY OK`.
2. Collect the evidence the card lists (`drive-app` skill for screenshots; `tests/perf/budgets.sh --only …` for `perf`), then `python3 scripts/evidence.py check F-0NN`.
3. Load the `spec-check` skill: map every criterion to its test.
4. Spawn the `reviewer` subagent with the feature id and the range `<base>..HEAD` (`base` is on the feature card). If the card lists `Reviews: … security-reviewer`, spawn that too. Fix every defect they confirm, then re-verify.
5. Run each reviewer at most twice. If a defect remains that you can't resolve, record it with `feature.py note` and in PROGRESS "Watch out".

## 6 · Hand off (load the `handoff` skill for the exact formats)

- `docs/PROGRESS.md`: rewrite the Current state block, and add one log entry at the top of the log.
- `docs/DECISIONS.md`: one D-entry per choice the spec didn't dictate. This includes versions pinned and libraries chosen.
- **Things only Jay can answer:** in an interactive session, ask him now and record the answer as a D-entry. In a headless run, or if he can't answer yet, add a Q-entry to `docs/QUESTIONS.md` with your recommended answer.
- `CHANGELOG.md`: one user-facing line under `## [Unreleased]`.
- The nearest folder `CLAUDE.md` → `## Learned`: one line per gotcha that would cost the next session time.

## 7 · Finish

- **Done:** run `python3 scripts/feature.py done F-0NN`. It re-runs verify. Then `git add -A && git commit -m "F-0NN: <summary>"`.
- **Not done:** run `python3 scripts/feature.py note F-0NN "<exactly where you stopped and what's next>"`, update PROGRESS, then commit `F-0NN: WIP <state>`.
- **Blocked:** run `python3 scripts/feature.py block F-0NN "needs Q-0NN: <why>"`, update PROGRESS, then commit.

- **Push**, only if `LECTER_ALLOW_PUSH=1`: `git pull --no-rebase origin main`, then `git push origin main`, then check CI (`docs/spec/16-ci-cd.md#branches-merging-and-pushing`).

Then stop. Do not start a second feature. The next session starts clean and will be faster for it. To build many features with Jay watching, use `PROMPT.orchestrate.md` instead.

If your context is getting long (many large outputs, or a compaction happened), jump to step 6 now and leave a precise note. A clean handoff beats a heroic finish.
