# tests/ (cross-cutting suites and fixtures)

Spec: `14-quality.md`, `16-ci-cd.md`. **How to add any kind of test: `docs/TESTING.md`** (read the recipe before writing a new kind).

| Folder | What | Rules |
|---|---|---|
| `fixtures/` | Small course folders, lectures, settings files | Checked in, tiny, synthetic or openly licensed |
| `corpus/` | Parse corpus + scorer (CER, LaTeX exact match, render-back) | `corpus/public/`: synthetic or openly licensed. `corpus/private/`: the maintainer's confidential files, local only. Refer to them by manifest id only (`docs/TESTING.md#private-lecture-files-confidential`) |
| `fake-provider/` | Scripted SSE server for all adapters | Deterministic; scenarios: slow first token, 429 + retry-after, 5xx, dropped stream, malformed SSE |
| `ai-eval/` | 50 fixed questions over a fixture course | Live only through `scripts/live.sh`; logs tokens, TTFT, accuracy per provider |
| `perf/` | Budget measurements (`budgets.sh`) | Prints measured vs budget; non-zero exit on breach. `budgets.json` is protected |
| `e2e/` | WebdriverIO flows on the real app (embedded WebDriver, all three OSes) | `drive-app` skill; Playwright-on-mocked-core lives in `ui/` |

- Tests never touch the user's real config folders: use `LECTER_TEST_HOME` / the `TestEnv` helper.
- Existing tests, snapshots, budgets and thresholds are protected (`14-quality.md#protected-checks`). Add; don't weaken.
- No sleeps for synchronisation. Wait on events or poll with a deadline helper.
- Every new test must fail for a wrong implementation: expected values from the spec, mocks only at process, network and OS edges, no assert-nothing or is-it-defined tests (`docs/TESTING.md#tests-that-catch-bugs`; the lint and mutation testing check it).

## Learned

- `tests/e2e/` has no node_modules: flows use the wdio globals (no package imports), packages are named as strings in wdio.conf.ts and resolve from ui/, where `scripts/e2e-app.sh` runs wdio; typecheck with `pnpm -C ui exec tsc -p ../tests/e2e/tsconfig.json` (F-016)
- The embedded WebDriver sends `browser.keys` as synthetic (untrusted) `KeyboardEvent`s to `document.activeElement`, so native default actions never run (Enter/Space don't click a focused button); the app must handle its keys itself (F-018)
- Keep `@wdio/tauri-service` (ui/package.json) and `tauri-plugin-wdio-webdriver` (app/Cargo.toml) on the same release: plugin 1.4 didn't build against tauri 2.12's webview2-com, and service 1.4 ran a msedgedriver check on Windows even when embedded, so no session got a hostname/port (CI-17ae5e6)
- Biome crashes on files outside ui/ ("path is expected to be under the root"); format them with `pnpm -C ui exec biome check --write --stdin-file-path=x.ts < file` (F-016)
- Vim's `:` command line (codemirror-vim prompt) submits on `keyCode === 13`: in a flow set its input's value in `browser.execute` and dispatch a keydown whose `keyCode` is defined as 13 (tests/e2e/flows/find.ts) (F-022)
- `expect($$(sel)).toHaveText([...])` fails on the embedded WebDriver ("Can't call getText … not a function"), and CodeMirror re-renders widgets (stale element refs): read texts with one `browser.execute` over `textContent`, which also skips CSS `text-transform` (F-020)
- CodeMirror ignores key events in a composition only after it changed the doc (`inputState.composing > 0`); codemirror-vim skips keydowns named Process/Unidentified/Dead but not keyCode 229 or `isComposing`. Flows read CM state via `.cm-content`'s `cmTile.root.view` (tests/e2e/flows/ime.ts) (F-027)
- WebDriver scripts time out after 30 s: open a long in-page measurement in one `browser.execute`, `browser.pause`, and read it in another, counting only events time-stamped inside the window (tests/e2e/flows/idle.ts) (F-029)
- The embedded WebDriver (plugin 1.5.0) clicks unlike a mouse: `$(…).click()` sends a lone `click` (no mousedown, so CodeMirror ignores it), and pointer actions send `detail: 0`, which CodeMirror reads as a triple click (whole-line selection, Vim goes visual). Click CodeMirror in-page with `detail: 1`, aimed at a character's measured rect, not a fixed offset: CI fonts differ (tests/e2e/flows/idle.ts `clickLine`) (F-029)
