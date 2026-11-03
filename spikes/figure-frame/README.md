# Spike F-028 · The figure frame's sandbox in three webviews

**Question.** In the real app's webview on each OS (WebKitGTK on Linux, WKWebView on macOS,
WebView2 on Windows), is a `sandbox="allow-scripts"` iframe under the CSP of
`08-figures.md#sandbox-pages` (`default-src 'none'; script-src lecter-fig: lecter-lib:;
style-src 'unsafe-inline'; img-src data:`), with the app's native request filter below it, unable
to reach the network, read the parent's DOM, use storage or call Tauri's IPC? Which watchdog
detects a busy frame within 2 s on each? (Runs 1 and 2 tested the CSP alone, with
`script-src 'self' lecter-lib:`; D-142 → D-145 added the filter and the scheme sources.)

## Method

The app doesn't serve `lecter-fig:` or `lecter-lib:` yet (F-141) and its CSP frames only
`lecter-fig:`, so the flow `tests/e2e/flows/figure-frame.ts` points the app's main webview (debug
build with the embedded WebDriver, CI's `e2e-app` job) at a harness from local servers
(`server.ts`), then back at the app. Three loopback origins:

- **page**: the harness and the probe frames. It is the frame origin, standing in for
  `lecter-fig:` (same URL origin as the parent, so only the sandbox separates them);
- **lib**: standing in for `lecter-lib:`;
- **net**: the network. Every probe request aims here, outside both figure origins.

**Native request filter** (`app/src/figure_filter/`, test-hooks builds only until F-141): before
the harness loads, the flow navigates the webview to
`<page>/__lecter-test/figure-filter?figure=<page>&figure=<lib>&page=<app origins>&next=<harness>`.
The app's test-hooks plugin cancels that navigation, arms the filter with those origins and loads
the harness with the outcome in its query (`ff-filter=armed&ff-filter-kind=…`), which the harness
grades (`harness filter native request filter armed`).

- WebKitGTK and WKWebView: a content rule list (`WebKitUserContentFilter`, `WKContentRuleList`):
  block every load whose `load-context` is `child-frame`, then `ignore-previous-rules` for
  `^data:` and each figure origin. The page itself is left alone.
- WebView2: a `WebResourceRequested` handler on `*`, every context, every source kind
  (`ICoreWebView2_22`); a refused request gets a 403 made in the app and never leaves. WebView2
  doesn't say which frame a request comes from, so the page's own origins (the app's, its IPC)
  pass as well; a frame's request to them is left to the CSP.

The pages:

- **Parent** (`pages/harness.js`): the main window's CSP (SEC-30) with `frame-src` scoped to the
  frame's folder. It stores secrets in its DOM, a global, localStorage, sessionStorage and a cookie,
  and calls the core (`app_info`) itself: Tauri injects its IPC into any page, and the core's answer
  (a rejection, since the page isn't local) is the control that the IPC is reachable from this
  webview.
- **Three frames** (`pages/probe.js`): `fig` loads its probe from the page origin and `lib` from
  the lib origin, each under the spec's CSP with its stand-in named next to the scheme
  (`script-src lecter-fig: <page> lecter-lib:` and `… lecter-lib: <lib>`); both must run.
  `bare` has no CSP: its network results are only observed and show what the filter stops alone.
- **Network (16 vectors):** fetch, fetch no-cors, XHR, sendBeacon, WebSocket, EventSource, image,
  CSS background, link prefetch, link preload (image, fetch), link stylesheet, nested iframe,
  `window.open`, then form submit and self-navigation, all at `<net>/beacon/<variant>-<name>`; the
  servers log every `/beacon/` request and answer 204 with `Access-Control-Allow-Origin: *`. A
  check passes only if the beacon never arrived and the call got no answer. Observed only: a
  prefetch to the frame's own origin (`own-origin`; the filter lets that origin through, and in
  the app it serves only hash-named files, SEC-33). Script loads are left out: the CSP names only
  the two schemes.
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
  show whether the frame runs on the parent's thread. Detection = the earlier leg. Before the
  loop, a 2 s idle baseline of the out-of-page leg must flag nothing, and its slowest ping must
  stay under 500 ms.

Every check prints `FRAME <webview> <scope> <area> <check>: ok|FAIL|observed (<detail>)`, then the
flow asserts none failed. `measure.mjs` runs the same harness in ui/'s Playwright browsers (no
Tauri and no filter, so the IPC control and the filter are only observed) to check the harness.

## Rerun

- All three webviews (CI): push the branch, then `gh workflow run ci.yml --ref <branch>`
  (workflow_dispatch adds macos-15 and windows-2025 to `e2e-app`). When it has finished:
  `spikes/figure-frame/fetch.sh <run-id>` appends the shard that ran this flow (per OS) to
  `.evidence/F-028/e2e-app.log`, with the app log's `figure filter` lines, and prints the tally
  (`summary.txt`).
- One webview (outside the Claude sandbox): `scripts/e2e-app.sh figure-frame --evidence F-028`,
  then `python3 spikes/figure-frame/summary.py .evidence/F-028/e2e-app.log`.
- The harness alone: `node spikes/figure-frame/measure.mjs [--engines chromium,webkit]`.

## Where the lines are

The lines go to the wdio output (`e2e-app.log`) and, on GitHub Actions, to the job summary (run
page, "F-028 figure-frame checks"). Since D-154 every `e2e-app-shard` job uploads `.verify/`
(artifact `e2e-app-<os>-<shard>`), passing or not, so `fetch.sh` finds every OS's lines; runs 1
and 2 uploaded only failing jobs.

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
   lecter-lib:` instead of `'self' lecter-lib:`. **Unverified with a real custom scheme:** the
   harness named an `http://127.0.0.1:<port>` origin, not a registered `lecter-fig:`/`lecter-lib:`
   scheme. F-141 must prove that each webview loads a frame script from a custom scheme named in
   `script-src`. This doesn't weaken criterion 1's proof on WebKit:
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
   The flow waited for it before it began watching, so every later ping came back in 4–15 ms.
   Fixed after run 1: the starting call is now the watcher's first ping
   (`watchOutOfPage(…, first)`), and a 2 s idle baseline runs first. Its pings must come back
   within 500 ms (a third of the stale limit) and none may be flagged, so an unanswered ping
   during the loop means a busy frame, not a slow WebDriver. Locally (Chromium, frame on the
   parent's thread), the slowest idle ping was 4 ms and the leg flags the loop at 1749 ms: the
   250 ms heartbeat plus the 1500 ms stale limit, the worst case for a loop that starts just after
   a ping. Run 2 measures it on WebKit.


**Run 2: CI run 41472212630** (head edcfe29, the out-of-page fix). WebKitGTK and WKWebView passed
(criterion 2 within 2 s; lines only in their job summaries); WebView2 failed only `<link
rel=prefetch>` again (both frames, beacon hit). `.evidence/F-028/run2-41472212630-summary.txt`.

**Run 3: CI run 41692656232** (head 32c50f6: native filter, D-145's scheme CSP, network origin,
`bare` frame; e2e-app in shards, D-154). Every `e2e-app-shard` job passed; the flow ran in shard 2
on Linux and shard 1 on macOS and Windows. `fetch.sh 41692656232` → `.evidence/F-028/summary.txt`:

| | WebKitGTK (ubuntu-24.04) | WKWebView (macos-15) | WebView2 (windows-2025, Edg 156) |
|---|---|---|---|
| Checks ok | 77/77 | 77/77 | 77/77 |
| Filter armed | content rule list (`WebKitUserContentFilter`) | content rule list (`WKContentRuleList`) | `WebResourceRequested`, all source kinds (`ICoreWebView2_22`) |
| Probe ran in `fig` and `lib` (scheme CSP) | yes, both | yes, both | yes, both |
| Network, `fig` and `lib` (16 vectors each) | all blocked | all blocked | all blocked, `<link rel=prefetch>` included |
| Network, `bare` (no CSP: filter + sandbox only) | 16/16 blocked | 16/16 blocked | 14/16 blocked: **WebSocket reached the server**; `fetch no-cors` resolved (opaque) on the filter's own 403, nothing reached the server |
| Prefetch to the frame's own origin (observed) | not sent | not sent | sent from `fig` and `bare` (that origin is a figure origin; `lib` didn't send it) |
| Parent DOM, storage, IPC | as runs 1–2: all blocked | all blocked | all blocked |
| Watchdog: in-page / out-of-page leg | 5000 / **1497 ms** | 5000 / **1527 ms** | **1354** / null ms |
| Frame on the parent's thread | yes (gap 5040 ms) | yes (5032 ms) | no (105 ms) |
| Idle baseline, slowest ping | 16 ms | 12 ms | 6 ms |

**What run 3 shows:**

1. **Criterion 1 holds in all three webviews** with the filter armed and the spec's CSP.
2. **Why WebView2 prefetched in runs 1–2:** Chromium checks `<link rel=prefetch>` against
   `script-src`, not `default-src`. In runs 1–2 the beacon was on the frame's own origin and
   `script-src` had `'self'`; locally (Chromium 156) a prefetch from a frame whose `script-src`
   names only another origin is blocked, and one to an origin `script-src` names goes out (the
   `own-origin` lines: `fig` names the page origin and sent it, `lib` doesn't and didn't). With
   D-145's `script-src lecter-fig: lecter-lib:` a figure can prefetch only from the two figure
   schemes, which serve only bundled or hash-named files. The filter is the second guard.
3. **What each guard covers:** on WebKit the content rule list alone stops all 16 vectors
   (`bare`). On WebView2 `WebResourceRequested` stops 15 of 16 alone; it doesn't see WebSocket
   handshakes, which only the CSP's `connect-src` (none) blocks. F-141 keeps both guards.
4. **Attribution:** WebView2's handler can't tell a frame's request from the page's, so the page's
   own origins (the app's, its IPC) pass for frames too; a frame request to them is left to the
   CSP. WebKit's `load-context: child-frame` scopes the rule list to frames exactly.
5. **Watchdog (criterion 2):** the out-of-page leg flags the busy WebKit frames at ~1.5 s, the
   in-page leg the WebView2 frame at 1.35 s; detection = the earlier leg, within 2 s everywhere.
