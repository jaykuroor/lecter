// F-028 spike: the figure frame's sandbox in the real app's webview (WebKitGTK, WKWebView,
// WebView2; 08-figures.md#sandbox-pages, 13-security.md#tauri-and-ipc). The app doesn't serve
// `lecter-fig:` or `lecter-lib:` yet (F-141), and its CSP only frames `lecter-fig:`, so the flow
// points the app's main webview at a harness page from a local server (spikes/figure-frame/):
// a parent page with the main window's CSP, `sandbox="allow-scripts"` frames under the CSP of
// 08-figures.md (`fig`: probe script from the frame origin, standing in for lecter-fig:; `lib`: from
// a second origin standing in for lecter-lib:; `bare`: no CSP, observed only). Before the harness
// loads, the flow arms the app's native request filter (app/src/figure_filter/, D-145) with those
// two origins by navigating to the arm URL; the app goes on to the harness with the outcome in its
// query. Tauri injects its IPC into that page as into any other, so the parent's own call to the
// core is the control that the IPC is there to be reached.
//
// Criterion 1: the filter is armed, and every network request the probe tries (fetch, XHR,
// beacon, WebSocket, EventSource, image, CSS, link prefetch/preload/stylesheet, nested frame,
// popup, form, navigation; all aimed at a third, "network" origin) never reaches the server, the
// parent's DOM, globals and location throw, storage
// throws or is empty and the parent sees no write, and the IPC can't be reached: Tauri's IPC
// endpoints are blocked and no answer from the core comes back for the frame's calls.
// Criterion 2: a 5 s busy loop in the frame is detected within 2 s by the two-leg watchdog: a
// heartbeat from the parent page, and a heartbeat from outside the page (WebDriver executes here,
// `webview.eval` from the core in the app) for webviews that run the frame on the parent's thread.
//
// Each check is logged as `FRAME <webview> <scope> <area> <check>: ok|FAIL|observed (<detail>)`
// before the test asserts them all, so one CI run gives every webview's failures; the lines also go
// to the GitHub job summary (spikes/figure-frame/README.md, "Where the lines are"). The webview is
// pointed back at the app at the end and the shell checked, so later flows find the app as at start.

import { appendFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  armUrl,
  DETECT_BUDGET_MS,
  type Harness,
  STALE_MS,
  startHarness,
  watchOutOfPage,
} from "../../../spikes/figure-frame/server.ts";
import { shot } from "../support/shot.ts";

/** A bounded busy loop: long enough to pass the 2 s budget, short enough that the app recovers. */
const BUSY_MS = 5000;
/** The idle baseline before the loop: how long, and the slowest ping that keeps it meaningful. */
const IDLE_MS = 2000;
const IDLE_PING_LIMIT_MS = STALE_MS / 3;
/** How long a request that got through has to reach the beacon log after the frames navigate. */
const OBSERVE_MS = 1500;
const observe = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The harness API (spikes/figure-frame/pages/harness.js). */
type Watch = {
  busyAsked: number | null;
  busyStart: number | null;
  busyEnd: number | null;
  flaggedAt: number | null;
  maxGap: number;
  pongs: number;
};
type Ff = {
  settled(): boolean;
  refreshHits(): number;
  hitsAt: number;
  busy(variant: string, ms: number): number;
  watch(variant: string): Watch;
  navigateTest(): number;
  frames: Record<string, { result?: unknown; navigateTried?: number; loaded?: unknown }>;
  grade(webview: string, final: boolean): { lines: string[]; failed: string[] };
};
type FfWindow = Window & { __ff?: Ff };

/** Which of the three webviews this is, from its user agent. */
function webview(ua: string): string {
  if (/Edg\//.test(ua)) return "WebView2";
  if (/Macintosh/.test(ua)) return "WKWebView";
  if (/Linux/.test(ua) && /AppleWebKit/.test(ua)) return "WebKitGTK";
  return `unknown(${ua})`;
}

/**
 * The job summary file: GITHUB_STEP_SUMMARY, or else the newest step summary in the runner's
 * file-commands folder (the F-027 run found no GITHUB_STEP_SUMMARY in the worker on one OS).
 */
function summaryFile(): string | null {
  const direct = process.env.GITHUB_STEP_SUMMARY;
  if (direct) return direct;
  const temp = process.env.RUNNER_TEMP;
  if (!temp) return null;
  const dir = join(temp, "_runner_file_commands");
  if (!existsSync(dir)) return null;
  const newest = readdirSync(dir)
    .filter((f) => f.startsWith("step_summary_"))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  return newest ?? null;
}

let summaryStarted = false;
/** Prints `line` and, on GitHub Actions, adds it to the job summary (a passing job keeps no log). */
function report(line: string): void {
  console.log(line);
  const file = summaryFile();
  if (!file) return;
  const head = summaryStarted ? "" : "\n#### F-028 figure-frame checks\n\n";
  summaryStarted = true;
  try {
    // Indented four spaces: one Markdown code block, so the lines read exactly as in the log.
    appendFileSync(file, `${head}    ${line}\n`);
  } catch (e) {
    console.log(`FRAME job summary not writable (${String(e)})`);
  }
}

let harness: Harness | null = null;
let appUrl = "";
let engine = "unknown";

const ff = () => browser.execute(() => (window as FfWindow).__ff !== undefined);

/** Re-reads the server's beacon log into the harness and waits until it has it. */
async function freshHits(): Promise<void> {
  const asked = await browser.execute(() => (window as FfWindow).__ff?.refreshHits() ?? 0);
  await browser.waitUntil(() => browser.execute((t: number) => ((window as FfWindow).__ff?.hitsAt ?? 0) >= t, asked), {
    timeout: 10_000,
    interval: 100,
    timeoutMsg: "the harness could not read the beacon log",
  });
}

describe("figure frame sandbox", function () {
  this.timeout(180_000);

  before(async () => {
    harness = await startHarness();
    const where = await browser.execute(() => ({ url: location.href, ua: navigator.userAgent }));
    appUrl = where.url;
    engine = webview(where.ua);
    report(`FRAME ${engine} harness info user-agent: observed (${JSON.stringify(where.ua)})`);
    report(
      `FRAME ${engine} harness info env: observed (${JSON.stringify({
        GITHUB_ACTIONS: process.env.GITHUB_ACTIONS ?? null,
        GITHUB_STEP_SUMMARY: Boolean(process.env.GITHUB_STEP_SUMMARY),
        RUNNER_TEMP: Boolean(process.env.RUNNER_TEMP),
        summary: summaryFile() !== null,
      })})`,
    );
    // The app's own origins (`tauri://localhost` has an opaque URL origin, so built by hand) and its
    // IPC: WebView2 can't tell a frame's request from the page's, so these pass for the page.
    const app = new URL(appUrl);
    const arm = armUrl(harness, [`${app.protocol}//${app.host}`, "http://ipc.localhost", "ipc://localhost"]);
    report(`FRAME ${engine} harness info arm: observed (${JSON.stringify(arm)})`);
    // The app cancels this navigation, arms the filter and then loads the harness itself.
    await browser.execute((u: string) => {
      location.href = u;
    }, arm);
    await browser.waitUntil(ff, { timeout: 20_000, interval: 100, timeoutMsg: "the harness page did not load" });
    await browser.waitUntil(() => browser.execute(() => (window as FfWindow).__ff?.settled() ?? false), {
      timeout: 40_000,
      interval: 200,
      timeoutMsg: "the probe frames did not report",
    });
  });

  // Back to the app: later flows find its shell as at start (shell.ts checks the same things).
  after(async () => {
    try {
      if (appUrl) await browser.url(appUrl);
      await expect($('[aria-label="Course rail"]')).toBeDisplayed({ wait: 30_000 });
      await expect($('[aria-label="Status line"] .status-version')).toHaveText(/^v\d+\.\d+\.\d+$/, { wait: 30_000 });
    } finally {
      await harness?.close();
    }
  });

  it("detects a busy loop in the frame within 2 s", async () => {
    const variant = await browser.execute(
      () => ["fig", "lib"].find((v) => (window as FfWindow).__ff?.frames[v]?.result) ?? "fig",
    );
    // Idle baseline: with nothing busy, a ping must come back well inside the stale limit, so an
    // unanswered ping during the loop means a busy frame, not a slow WebDriver.
    const idle = await watchOutOfPage(() => browser.execute(() => 1), IDLE_MS);
    const idleOk = idle.detectedAt === null && idle.maxPingMs <= IDLE_PING_LIMIT_MS;
    report(
      `FRAME ${engine} ${variant} watchdog idle pings answered within ${IDLE_PING_LIMIT_MS} ms: ${idleOk ? "ok" : "FAIL"} (${JSON.stringify({ maxPingMs: idle.maxPingMs, flagged: idle.detectedAt !== null, idleMs: IDLE_MS })})`,
    );
    // Not awaited: where the frame shares the page's thread this call returns only when the loop
    // ends, so the out-of-page leg watches it as its first ping.
    const trigger = browser.execute(
      (v: string, ms: number) => (window as FfWindow).__ff?.busy(v, ms),
      variant,
      BUSY_MS,
    );
    const outside = await watchOutOfPage(() => browser.execute(() => 1), BUSY_MS + 1500, trigger);
    await browser.waitUntil(
      () => browser.execute((v: string) => (window as FfWindow).__ff?.watch(v).busyEnd != null, variant),
      { timeout: 20_000, interval: 100, timeoutMsg: "the busy loop did not end" },
    );
    const inside = await browser.execute((v: string) => (window as FfWindow).__ff?.watch(v) ?? null, variant);
    if (!inside) throw new Error("the harness is gone");
    const start = inside.busyStart ?? inside.busyAsked ?? 0;
    const inPage = inside.flaggedAt === null ? null : inside.flaggedAt - start;
    const outOfPage = outside.detectedAt === null ? null : outside.detectedAt - start;
    const legs = [inPage, outOfPage].filter((x): x is number => x !== null);
    const detected = legs.length > 0 ? Math.min(...legs) : Number.POSITIVE_INFINITY;
    const detail = {
      inPageMs: inPage,
      outOfPageMs: outOfPage,
      parentMaxGapMs: inside.maxGap,
      maxPingMs: outside.maxPingMs,
      busyMs: BUSY_MS,
    };
    const ok = detected <= DETECT_BUDGET_MS;
    report(
      `FRAME ${engine} ${variant} watchdog detected within ${DETECT_BUDGET_MS} ms: ${ok ? "ok" : "FAIL"} (${JSON.stringify(detail)})`,
    );
    // Which leg sees it, and whether the parent froze with the frame, decide F-142's design.
    report(
      `FRAME ${engine} ${variant} watchdog frame shares the parent's thread: observed (${JSON.stringify({ shares: inside.maxGap >= BUSY_MS / 2 })})`,
    );
    expect(idle.detectedAt).toBeNull();
    expect(idle.maxPingMs).toBeLessThanOrEqual(IDLE_PING_LIMIT_MS);
    expect(detected).toBeLessThanOrEqual(DETECT_BUDGET_MS);
  });

  it("keeps the sandboxed frame off the network, the parent, storage and the IPC", async () => {
    await shot("figure-frame-harness");
    await browser.execute(() => (window as FfWindow).__ff?.navigateTest());
    await browser.waitUntil(
      () =>
        browser.execute(() =>
          Object.values((window as FfWindow).__ff?.frames ?? {}).every((f) => !f.loaded || f.navigateTried),
        ),
      { timeout: 10_000, interval: 100, timeoutMsg: "the frames did not try to navigate" },
    );
    // A blocked request leaves no trace: this is an observation window, not a wait for an event.
    await observe(OBSERVE_MS);
    await freshHits();
    const graded = await browser.execute((w: string) => (window as FfWindow).__ff?.grade(w, true) ?? null, engine);
    if (!graded) throw new Error("the harness is gone");
    for (const line of graded.lines) report(line);
    expect(graded.failed).toEqual([]);
  });
});
