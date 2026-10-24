---
name: spec-check
description: Audit that every acceptance criterion of the current feature is covered by a passing test and matches the cited spec. Use right before running the reviewer and feature.py done.
---

# Spec check

1. Print the criteria and spec: `python3 scripts/feature.py show F-0NN` and `python3 scripts/spec.py F-0NN`.
2. Build this table in your reply (not in a file):

   | # | Criterion (short) | Test (path::name) | Failing run (evidence file) | Passes now? |
   |---|---|---|---|---|

   - **Failing run:** the saved output from step 3 of PROMPT.md in `.evidence/F-0NN/`, or a run with the key line temporarily reverted. Say which.
   - One test may cover several criteria only if it asserts each of them explicitly.
3. Read the cited spec sections once more against your diff (`git diff --stat <start>..HEAD`, then the files that matter). Look for:
   - behaviour the spec states that the criteria don't (an exact key, a file name, a default value, an error message);
   - things you built that the spec doesn't ask for (remove them);
   - anything from `docs/spec/15-later.md` (remove it).
4. Check the cross-cutting must-haves that apply:
   - **performance budget:** if you touched the keystroke path, startup, idle, memory or retrieval, run `bash tests/perf/budgets.sh --only <id>` and save it as `perf.txt`;
   - **security:** for untrusted input, check the size limits, path checks and sandbox (`13-security.md`);
   - **configurable:** every new default is a setting in the schema, with precedence (`12-settings-theme-onboarding.md`);
   - **mouse and key:** every new action is reachable both ways and shows in the hint bar or keycaps (`09-ui.md`);
   - **design:** UI matches `docs/design/components.md` and uses only tokens from `docs/design/tokens.json`.
5. `python3 scripts/evidence.py check F-0NN`: every evidence item on the card exists.
6. Any empty cell or "no" is a gap. Close it before calling the reviewer. Definition of done: `docs/spec/14-quality.md#definition-of-done`.
