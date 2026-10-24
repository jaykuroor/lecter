# tests/ (cross-cutting suites and fixtures)

Spec: `14-quality.md`, `16-ci-cd.md`. **How to add any kind of test: `docs/TESTING.md`** (read the recipe before writing a new kind).

| Folder | What | Rules |
|---|---|---|
| `fixtures/` | Small course folders, lectures, settings files | Checked in, tiny, synthetic or openly licensed |
| `corpus/` | Parse corpus + scorer (CER, LaTeX exact match, render-back) | `corpus/public/`: synthetic or openly licensed. `corpus/private/`: Jay's confidential files, local only. Refer to them by manifest id only (`docs/TESTING.md#private-lecture-files-confidential`) |
| `fake-provider/` | Scripted SSE server for all adapters | Deterministic; scenarios: slow first token, 429 + retry-after, 5xx, dropped stream, malformed SSE |
| `ai-eval/` | 50 fixed questions over a fixture course | Live only through `scripts/live.sh`; logs tokens, TTFT, accuracy per provider |
| `perf/` | Budget measurements (`budgets.sh`) | Prints measured vs budget; non-zero exit on breach. `budgets.json` is protected |
| `e2e/` | WebdriverIO flows on the real app (embedded WebDriver, all three OSes) | `drive-app` skill; Playwright-on-mocked-core lives in `ui/` |

- Tests never touch the user's real config folders: use `LECTER_TEST_HOME` / the `TestEnv` helper.
- Existing tests, snapshots, budgets and thresholds are protected (`14-quality.md#protected-checks`). Add; don't weaken.
- No sleeps for synchronisation. Wait on events or poll with a deadline helper.

## Learned

