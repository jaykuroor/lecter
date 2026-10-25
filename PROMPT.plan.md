You are a planning session for the Lecter v0 build (`LECTER_PLANNING=1`). You don't write product code. You bring the plan back in line with the maintainer's latest answers and spec changes, so build sessions can keep running.

1. Read `docs/QUESTIONS.md`. For every entry the maintainer has answered (an `Answer:` line that isn't blank) that is still marked `open`:
   - Apply the answer.
     - If it changes what to build: edit the relevant `docs/spec/` section (keep the style: short, concrete, testable).
     - If it settles a gap: write a D-entry citing the Q-number (decider: maintainer).
   - Change the heading status from `open` to `answered`.
2. Check `git log --oneline -- docs/spec` since the last `plan:` commit. For each spec change, find affected features: `grep` the changed anchors in `docs/features.json` via `python3 scripts/next.py --list` and `python3 scripts/feature.py show`.
   - **`todo` or blocked feature:** fields may be edited, with `python3 scripts/feature.py set F-0NN acceptance '<json list>'` (also `title`, `spec`, `depends_on`, `verify`, `priority`, `needs`, `paths`, `evidence`, `reviews`, `protected`, `try`, `ask_maintainer_first`).
   - **`done` feature whose behaviour must change:** never reopen it. Add a new feature with `python3 scripts/feature.py add '<json>'` (next free id in that milestone's range, `depends_on` the old one, criteria describing only the change).
   - **Blocked feature whose question is now answered:** `python3 scripts/feature.py unblock F-0NN`.
3. New work the maintainer asked for, including their notes from a milestone gate (`docs/QUESTIONS.md` → `## Gate notes`), becomes new features in the same format:
   - EARS criteria ("WHEN … THEN the app SHALL …").
   - Each criterion is testable by a machine.
   - Cite spec anchors that exist (`python3 scripts/spec.py --toc`).
   - Use real dependencies.
   - 2–8 criteria per feature, one behaviour each; split anything bigger.
   - Owned `paths` (globs), `evidence` (`screenshot:<state>`, `log:<name>`, `harness:<name>`, `perf`), `reviews: ["security"]` when it touches the parse worker, IPC or capabilities, keys, the network, the figure iframe, file writes or the updater, and a one-line `try` for the maintainer's gate checklist when they can see it in the app.
   - A gate note goes into the next milestone; it never reopens a passed gate.
4. Run `python3 scripts/spec.py --check` and `python3 scripts/next.py --list`. Read the order: does every feature come after what it needs?
5. In `docs/PROGRESS.md`:
   - Add a log entry `plan: <what changed>`.
   - Update Current state if the next feature changed.
6. Commit: `plan: <summary>`. Stop.
