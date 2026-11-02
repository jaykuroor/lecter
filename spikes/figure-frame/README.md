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

**Local, Playwright Chromium 156 (no Tauri), `measure.mjs`:** 69/71 checks ok.
- **`<link rel=prefetch>` reaches the network** from both frames (`hit: true`): Chromium doesn't
  apply `default-src 'none'` to prefetch. Every other vector is blocked by the CSP
  (`connect-src`, `img-src`, `style-src-elem`, `frame-src` violations) or the sandbox (popup, form).
  If WebView2 behaves the same, criterion 1 can't be met by the CSP alone on Windows; the frame
  needs a request filter outside the page (WebView2 `WebResourceRequested` refusing anything but
  `lecter-lib:`/`lecter-fig:` from the frame).
- Parent, storage and IPC: all blocked (SecurityError for every storage API and parent read; no
  IPC object in the frame; both IPC endpoints blocked by `connect-src`).
- Watchdog: the sandboxed frame runs on the parent's thread (parent timer gap 5066 ms for a
  5000 ms loop), so the in-page leg sees the loop only when it ends (5000 ms); the out-of-page leg
  flags it at 1503 ms.

**CI (three webviews):** pending; `fetch.sh <run-id>` fills this in.
