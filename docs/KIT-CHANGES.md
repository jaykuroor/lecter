# Kit changes for the maintainer to apply (2026-11-05)

A list of edits to guarded kit files that builders and the orchestrator can't make. Jay (the maintainer) reviews it, then has an agent apply it. When everything is done, delete this file in the same commit.

## For the agent applying this

- **Run with `LECTER_KIT_EDIT=1`.** The guard (`scripts/hooks/guard.py`) blocks `tests/perf/budgets.json`, `.github/workflows/*` and `.claude/settings*.json` otherwise. The sandbox also blocks shell writes to `.claude/settings.json`, so edit it with the Edit tool (Jay approves the prompt).
- **Work in your own worktree on a branch** (`kit/2026-11-05`), because the orchestrator session commits on `main` at the same time. When done, run `scripts/verify.sh` in the worktree. Then merge into `main` with `git merge --no-ff`, but only while the orchestrator isn't mid-merge (ask Jay). Don't push: the orchestrator pushes with its next merge.
- **Text only.** Change no budget value, target, `on_ci`, `per_os`, `local` or `median_of`. Change no workflow step. Each change below says exactly what to edit. Anything else you notice goes into your final message, not into the files.
- **Commits:** follow Jay's git rules. Jay is the only author, with no `Co-Authored-By` lines. Start with a short plain-language sentence saying what changed and where the details are. Refer to Jay as "author", never in the third person. One commit per change group (A, B, C) is fine.
- **Check:** after group A, run `python3 -m unittest discover -s tests/perf -p 'test_budgets*.py'` (41+ tests must pass) and `python3 -c "import json; json.load(open('tests/perf/budgets.json'))"`.

## A. Perf budget descriptions are out of date after F-181 (D-225 to D-228)

Since F-181, under `--ci` the real-app `cold_open_ms`, `rss_300_slides_mb` and `idle_rss_mb` print REPORT on every OS and never fail. The macOS mocked-core keystroke check reports too, and Linux and Windows still gate it at 8 ms x1.5. macOS `rss_300_slides_mb` is the median of 3 settles. The list of report-only budgets lives in `tests/perf/harness.py` (`VM_REPORT`, `QUICK_VM_REPORT`; D-226) because builders can't edit budgets.json. The reviewer flagged the texts below as stale.

### A1. `tests/perf/budgets.json` → top-level `about`

Replace this clause:

> on_ci = report: with --ci the real-app value prints REPORT and its quick check gates (D-146, D-155);

with:

> on_ci = report: with --ci the real-app value prints REPORT and never fails, and a `quick` check, if the budget has one, gates instead (D-146, D-155); tests/perf/harness.py's VM_REPORT (cold_open_ms, rss_300_slides_mb, idle_rss_mb) also REPORTs under --ci on every OS, and QUICK_VM_REPORT makes the macOS keystroke quick check REPORT (D-225, D-226, D-227);

### A2. `tests/perf/budgets.json` → `cold_open_ms.how`

Replace `per_os = the CI runner targets (D-152), gated by the e2e-app cold-open flow;` with:

> per_os = the CI runner targets (D-152), reported but not gated under --ci and by the e2e-app cold-open flow, which prints its median of 5 (D-225);

### A3. `tests/perf/budgets.json` → `rss_300_slides_mb.how`

Replace `on macOS the sample after the 5 s settle counts, elsewhere the larger of the two (D-161)` with:

> on macOS the median of 3 settles of 5 s each counts and every sample is listed (D-228), elsewhere the larger of the two samples (D-161); under --ci it prints REPORT and never fails (D-225)

### A4. `tests/perf/budgets.json` → `idle_rss_mb.how`

Append to the end of the string: `; under --ci it prints REPORT and never fails (D-225)`.

### A5. `.github/workflows/ci.yml`, comment above the `perf:` job (around lines 129-135)

Two edits in that comment (the text wraps over `#` lines; keep the wrapping under ~100 columns):

1. `(timing x1.5 with one re-measure; memory, size and token budgets exact)` becomes `(timing x1.5 with one re-measure; memory, size and token budgets exact, except the real-app ones below)`.
2. The sentence `Under --ci the real-app keystroke_p99_ms and cold_open_ms print REPORT and the mocked-core keystroke trace (Playwright Chromium) gates (D-146, D-155).` becomes:

   > Under --ci the real-app keystroke_p99_ms, cold_open_ms, rss_300_slides_mb and idle_rss_mb print REPORT and never fail, because shared VM runners are too noisy to gate them (D-225); they gate on the author's machine at milestone gates. The mocked-core keystroke trace (Playwright Chromium) gates on Linux and Windows and reports on macOS (D-146, D-155, D-227).

Keep the comment's other lines as they are.

### A6. `.github/workflows/ci.yml`, comment above the `perf-os:` job (around lines 163-165)

After `an OS without a target yet prints REPORT.`, add: `Under --ci the real-app memory and cold-open values REPORT on every OS (D-225).`

## B. Sandbox network: let the orchestrator read CI logs and reports

`PROMPT.orchestrate.md` tells the orchestrator to run `gh run view <id> --log-failed` and to read CI results. In this session, reading a job log or downloading a run's artifacts was refused by the sandbox until these hosts were allowed one command at a time. In a session that isn't in auto mode, there is no way to allow them, so the CI watch and FIX rounds can't read logs.

### B1. `.claude/settings.json` → `sandbox.network.allowedDomains`

Add:

```json
"results-receiver.actions.githubusercontent.com",
"*.actions.githubusercontent.com",
"*.blob.core.windows.net"
```

(GitHub serves job logs and artifacts through these hosts; `*.blob.core.windows.net` is the Azure storage behind them.) If Jay prefers a narrower list, run `gh run view <id> --log-failed` and `gh run download <id>` once in a session not in auto mode and add only the hosts the sandbox reports.

## C. `PROMPT.orchestrate.md`: git steps the sandbox can't do

The sandbox can't write `.git/config` or delete folders under `.git/worktrees/` ("Device or resource busy").

- `git push -u origin <branch>` pushed the branch but failed to set upstream ("could not lock config file .git/config"). The same warning came back on `git branch -d`.
- `git worktree remove` / `git worktree prune` remove the worktree but leave its `.git/worktrees/<name>` metadata. 24 such folders are there now. They're harmless.

### C1. Section "Features that must pass on macOS and Windows", step 1

Change `git push -u origin <branch>` to `git push origin <branch>` (no `-u`: the sandbox can't write `.git/config`, and nothing needs the upstream).

### C2. Section "Merge", step 5

Append: `In the sandbox, git may report "Device or resource busy" for .git/worktrees/<name> or "could not lock config file": the worktree and branch are still gone (check git worktree list / git branch). Leave the leftover metadata; the maintainer runs git worktree prune outside the sandbox now and then.`

## D. Housekeeping for Jay (outside the sandbox, not an agent's job)

Run these yourself (type `! <command>` in the session) when no builder is running:

- `git worktree prune` clears the 24 stale `.git/worktrees/agent-*` folders.
- `.claude/worktrees/agent-a7f66c0a4f272d19c` and `.claude/worktrees/agent-ada7bd0ca8b2d457f` are leftovers from earlier builders and aren't in `git worktree list`. Check them for anything unmerged (`git -C <dir> status`, `git -C <dir> log --oneline -3`), then delete them. Don't touch the running builder's worktree (`agent-abc2388e3466cb147`, F-041).

## Not included, on purpose

- **Q-034 (local memory targets):** answered by D-229 (own median vs comparable apps). It's a planning change to budgets.json values once the numbers exist, not a text edit.
- **Moving `VM_REPORT` into budgets.json as `on_ci: "report"`** (D-226's "revisit if"): `tests/perf/test_budgets_os.py:79` pins which entries carry `on_ci`, and harness.py would change with it, so it needs a card, not a kit edit.
- **PROGRESS still says `cargo deny` fails and Dependabot `@types/node` past 24 fails:** both are already fixed (`deny.toml` ignores, D-169; `.github/dependabot.yml` ignores major updates of `@types/node`). The orchestrator will correct PROGRESS at the next handoff.
