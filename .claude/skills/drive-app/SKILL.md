---
name: drive-app
description: Run the real Lecter app (debug build) and drive it, to see a change working and collect evidence (screenshots, logs, harness output) in .evidence/<F-id>/. Use for every UI or app feature before reporting done, and when a bug only shows in the real app.
---

# Drive the real app

Three ways to see behaviour, cheapest first. Use the cheapest one that proves the criterion.

| Need | Tool | Arrives with |
|---|---|---|
| Core behaviour with no GUI (import, parse, search, assemble a prompt, render a lecture) | `cargo run -q -p lecter-harness -- <command> --json` | F-015 |
| UI flow against the mocked core (fast) | `pnpm -C ui exec playwright test e2e/<flow>.spec.ts --reporter=line` | F-011 |
| The real app, real core | `scripts/e2e-app.sh` (WebdriverIO + the embedded WebDriver server in debug builds) | F-016 |

## The real app

```
xvfb-run -a scripts/e2e-app.sh <flow> --evidence F-0NN     # Linux without a display
scripts/e2e-app.sh <flow> --evidence F-0NN                 # with a display, macOS, Windows
```

- Flows live in `tests/e2e/flows/<name>.ts`. A flow drives keys exactly as `10-keymap.md` lists them, and the mouse path for the same action.
- `--evidence F-0NN` saves `<state>.png` for every `await shot('<state>')` in the flow, plus `app.log` (the core's log for the run), into `.evidence/F-0NN/`.
- The run uses a throwaway home: `LECTER_TEST_HOME` (config, data, cache in a temp dir), `LECTER_TEST_TRUST=1` (answers the folder-trust screen) and `LECTER_TEST_PICK=<path>` (the next native file or folder dialog returns this path). WebDriver can't see native dialogs; these hooks exist only in debug builds (`01-architecture.md#debug-only-test-hooks`).
- Test courses come from `tests/fixtures/` (synthetic). Private corpus files may be opened locally, but their screenshots never leave `.evidence/` (git-ignored) and never go in a report.
- Inside the Claude Code sandbox, WebKitGTK can't start its own nested sandbox: `scripts/e2e-app.sh` sets `WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1` for debug test runs only. Never set it anywhere else.

## Evidence

- Name each item as the feature card does: `screenshot:gloss-streaming` → `.evidence/F-0NN/gloss-streaming.png`; `log:tests` → `tests.log`; `harness:search` → `search.json`; `perf` → `perf.txt`.
- Failing-then-passing proof: run the new tests before the implementation and save the output (`… 2>&1 | tail -n 60 > .evidence/F-0NN/tests-before.log`), then after (`tests.log`).
- UI screenshots: compare with the matching crop in `docs/design/reference/` and the component's entry in `docs/design/components.md`. Same layout, tokens and states; content differs.
- Check: `python3 scripts/evidence.py check F-0NN`.

## When it won't start

1. `scripts/verify.sh --quick` first: a build error is cheaper to read there.
2. Read `.evidence/F-0NN/app.log`, then `.verify/e2e-app.log`.
3. Blank window on Linux: WebKitGTK needs `xvfb-run -a` and, in the sandbox, the variable above.
4. Two identical failures: report `BLOCKED` with the logs (stuck rule).
