# Spike F-028 · The figure frame's sandbox in three webviews

**Question.** In the real app's webview on each OS (WebKitGTK on Linux, WKWebView on macOS,
WebView2 on Windows), is a `sandbox="allow-scripts"` iframe under the CSP of
`08-figures.md#sandbox-pages` (`default-src 'none'; script-src 'self' lecter-lib:; style-src
'unsafe-inline'; img-src data:`) unable to reach the network, read the parent's DOM, use storage
or call Tauri's IPC? Which watchdog detects a busy frame within 2 s on each?

## Method

The app doesn't serve `lecter-fig:` or `lecter-lib:` yet (F-141) and its CSP frames only
`lecter-fig:`, so the flow `tests/e2e/flows/figure-frame.ts` points the app's main webview (debug
build with the embedded WebDriver, CI's `e2e-app` job) at a harness from a local server
(`server.ts`), then back at the app:

- **Parent** (`pages/harness.js`): the main window's CSP (SEC-30) with `frame-src` scoped to the
  frame's folder. It stores secrets in its DOM, a global, localStorage, sessionStorage and a cookie,
  and calls the core (`app_info`) itself: Tauri injects its IPC into any page, and the core's answer
  (a rejection, since the page isn't local) is the control that the IPC is reachable from this
  webview.
- **Two frames** (`pages/probe.js`), same URL origin as the parent so only the sandbox separates
  them: `self` has the spec's exact CSP and loads its probe from `'self'`; `lib` loads it from a
  second origin added to `script-src`, standing in for `lecter-lib:`.
- **Network:** fetch (same and cross origin), XHR, sendBeacon, WebSocket, EventSource, image, CSS
  background, link prefetch, link preload (image, fetch), link stylesheet, nested iframe,
  `window.open`, then form submit and self-navigation. Every one aims at `/beacon/<variant>-<name>`
  on the server, which logs it and answers 204 with `Access-Control-Allow-Origin: *`; a check
  passes only if the beacon never arrived (and a fetch/XHR didn't get a status). Script loads are
  left out: in the app `'self'` and `lecter-lib:` serve only bundled or hash-named files (SEC-33).
- **Parent:** `parent.document`, `top.document`, `frameElement`, a parent global,
  `parent.location.href` must throw or be empty.
- **Storage:** localStorage, sessionStorage, IndexedDB, CacheStorage, `storage.getDirectory` must
  throw; the cookie must neither show the parent's secret nor keep a write; the parent sees no write.
- **IPC:** what of it exists in the frame (`__TAURI_INTERNALS__`, `window.ipc`,
  `webkit.messageHandlers.ipc`, `chrome.webview`) is logged. `ipc://localhost` and
  `http://ipc.localhost` must be blocked; the frame's `invoke` (if Tauri injected one; wry adds init
  scripts to subframes on Windows) must not resolve; a raw post on any native channel is sent with
  callback ids no page uses. The core answers by evaluating `runCallback(id)` in the *main* frame,
  where an unknown id logs "Couldn't find callback id": the parent watches for that, so any answer
  to a frame's call fails the check.
- **Watchdog (criterion 2):** the frame runs a bounded 5 s busy loop. Two legs watch it, each with
  a 250 ms heartbeat and a frame flagged busy once a beat is 1.5 s overdue (so detection lands
  within 1.5–1.75 s, under the 2 s budget): the **in-page** leg (the parent pings the frame by
  `postMessage`) and the **out-of-page** leg (a trivial script evaluated in the page from outside:
  a WebDriver execute here, `webview.eval` from the core in the app). The parent's own timer gaps
  show whether the frame runs on the parent's thread. Detection = the earlier leg.

Every check prints `FRAME <webview> <scope> <area> <check>: ok|FAIL|observed (<detail>)`, then the
flow asserts none failed. `measure.mjs` runs the same harness in ui/'s Playwright browsers (no
Tauri, so the IPC control is only observed) to check the harness itself.

## Rerun

- All three webviews (CI): push the branch, then `gh workflow run ci.yml --ref <branch>`
  (workflow_dispatch adds macos-15 and windows-2025 to `e2e-app`). When it has finished:
  `spikes/figure-frame/fetch.sh <run-id> [job-summary.txt ...]` appends the logs to
  `.evidence/F-028/e2e-app.log` and prints the tally (`summary.txt`).
- One webview (outside the Claude sandbox): `scripts/e2e-app.sh figure-frame --evidence F-028`,
  then `python3 spikes/figure-frame/summary.py .evidence/F-028/e2e-app.log`.
- The harness alone: `node spikes/figure-frame/measure.mjs [--engines chromium,webkit]`.

## Where the lines are

The lines go to the wdio output and, on GitHub Actions, to the job summary (run page, "F-028
figure-frame checks"); when `GITHUB_STEP_SUMMARY` is missing in the worker the flow falls back to
the newest `step_summary_*` in `$RUNNER_TEMP/_runner_file_commands/`, and it logs which of those it
saw (`harness info env`). verify.sh keeps e2e-app's output in `.verify/`, and `ci.yml` uploads that
only when the job fails, so a passing job's lines are only in its job summary, which gh can't
download. The kit change that makes every OS's lines downloadable: the e2e-app upload step's
`if: failure()` → `if: always()` (not in this card's paths).

## Results

**Run 1: CI run 41461890948** (head a656c4c, `workflow_dispatch`). All three `e2e-app` jobs
failed, so all three uploaded their logs. `fetch.sh 41461890948 <artifacts>` gives this tally
(`.evidence/F-028/summary.txt`):

| | WebKitGTK (ubuntu-24.04) | WKWebView (macos-15) | WebView2 (windows-2025, Edg 155) |
|---|---|---|---|
| Checks ok | 38/39 | 38/39 | 70/72 |
| Probe ran in `self` (exact CSP, script from `'self'`) | **no** (`loaded: false`) | **no** | yes |
| Probe ran in `lib` (script from the lib origin) | yes | yes | yes |
| Network (16 vectors per frame) | all blocked | all blocked | all blocked **except `<link rel=prefetch>`** (beacon hit, both frames) |
| Parent DOM, globals, location | all throw / null | all throw / null | all throw / null |
| Storage (6 APIs + cookie; parent sees no write) | all blocked | all blocked | all blocked |
| IPC endpoints (`ipc://`, `http://ipc.localhost`) | blocked (CSP) | blocked (CSP) | blocked (CSP) |
| IPC objects in the frame (observed) | `webkit.messageHandlers.ipc` | `webkit.messageHandlers.ipc` | `__TAURI_INTERNALS__.invoke`, `window.ipc`, `chrome.webview` |
| Frame's IPC call answered by the core | no (raw post, no key) | no (raw post, no key) | no (`invoke` and raw post: no answer, no stray callback) |
| Control: the core answers the parent | yes (ACL rejection) | yes | yes |
| Frame on the parent's thread | yes (parent timer gap 5091 ms) | yes (5011 ms) | no (112 ms) |
| Watchdog, in-page leg | 5000 ms (sees the loop only when it ends) | 5008 ms | **1285 ms** |
| Watchdog, out-of-page leg | null (flow bug, below) | null (flow bug) | null (the page never blocked) |

**What the run shows:**

1. **Network on WebView2:** Chromium doesn't apply `default-src 'none'` to `<link rel=prefetch>`,
   so a figure can send a GET to any URL it builds. Playwright Chromium 156 does the same locally;
   WebKit didn't send it. The CSP and sandbox of 08-figures.md can't keep a figure off the network
   on Windows, so criterion 1 can't be met there as specified. Something outside the page has to
   block it: WebView2's `WebResourceRequested` (filter `*`, all contexts) refusing every request
   whose URL isn't `lecter-fig:`, `lecter-lib:` or the app's own origin. That is native code for
   F-141.
2. **`'self'` on WebKit:** in a sandboxed (opaque-origin) frame, WebKitGTK and WKWebView never
   match `'self'`. Under the exact CSP, a figure's own script from `lecter-fig:` would not run.
   Chromium matches the response URL's origin. A scheme source works in all three: the `lib`
   frame's script origin is named explicitly and ran everywhere. So `script-src lecter-fig:
   lecter-lib:` instead of `'self' lecter-lib:`. This doesn't weaken criterion 1's proof on WebKit:
   the `lib` frame's CSP is the spec's, with the stand-in for `lecter-lib:`, and every check held.
3. **IPC:** on WebView2, wry adds Tauri's init scripts to subframes, so the figure frame holds
   `__TAURI_INTERNALS__` with the invoke key. Its calls still go nowhere: the custom-protocol fetch
   is blocked by `connect-src`, and WebView2 hands an iframe's `chrome.webview.postMessage` to
   `CoreWebView2Frame.WebMessageReceived`, which wry doesn't listen to. On WebKit the frame has
   `webkit.messageHandlers.ipc`, which reaches the core, but no key, and the core drops keyless
   messages. So each webview has two guards today. On WebView2, a wry change that forwards frame
   messages, or a looser CSP, would leave only one.
4. **Watchdog on WebKit:** the frame shares the page's main thread, so the in-page leg can't run
   during the loop. The out-of-page leg gave null because of a bug in the flow, not in WebKit. The
   WebDriver call that starts the loop only returned when the loop ended (wdio log: sent
   14:31:53.096, answered 14:31:58.101 on WebKitGTK; 14:37:45.201 → 14:37:50.217 on WKWebView).
   The flow waited for it before it began watching, so every later ping came back in 4–15 ms. Fixed after run 1: the starting call is now the watcher's first ping
   (`watchOutOfPage(…, first)`). Locally (Chromium, frame on the parent's thread), that leg flags
   the loop at 1751 ms: the 250 ms heartbeat plus the 1500 ms stale limit, the worst case for a
   loop that starts just after a ping. Run 2 measures it on WebKit.

**Run 2** (the out-of-page fix): pending; `fetch.sh <run-id>` fills it in.
