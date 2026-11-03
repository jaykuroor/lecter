#!/usr/bin/env node
// F-028 spike, local run: drives the figure-frame harness (server.ts, pages/) in ui/'s Playwright
// browsers, the same steps the e2e flow takes in the app's webview, minus Tauri's IPC (the IPC
// control is reported as observed here). Prints the FRAME lines and exits 1 if a check failed.
//   node spikes/figure-frame/measure.mjs [--engines chromium,webkit] [--busy-ms 5000]
// Node 24 runs server.ts directly (type stripping).

import { createRequire } from "node:module";
import { join } from "node:path";
import { DETECT_BUDGET_MS, STALE_MS, startHarness, watchOutOfPage } from "./server.ts";

const require = createRequire(join(import.meta.dirname, "../../ui/package.json"));
const playwright = require("@playwright/test");

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}
const ENGINES = arg("engines", "chromium").split(",");
const BUSY_MS = Number(arg("busy-ms", "5000"));

const until = async (what, fn, ms = 30000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out: ${what}`);
};

let failed = 0;
const harness = await startHarness();
try {
  for (const engine of ENGINES) {
    const browser = await playwright[engine].launch();
    const page = await browser.newPage();
    const name = `${engine}-${browser.version()}`;
    await page.goto(harness.url);
    await until("frames settled", () => page.evaluate(() => window.__ff?.settled() ?? false));

    // Busy loop in the first frame whose probe ran; both watchdog legs watch it.
    const v = await page.evaluate(() => ["fig", "lib"].find((x) => window.__ff.frames[x]?.result) ?? "fig");
    // Idle baseline: pings must come back well inside the stale limit when nothing is busy.
    const idle = await watchOutOfPage(() => page.evaluate(() => 1), 2000);
    const idleOk = idle.detectedAt === null && idle.maxPingMs <= STALE_MS / 3;
    const idleLine = `FRAME ${name} ${v} watchdog idle pings answered within ${STALE_MS / 3} ms: ${idleOk ? "ok" : "FAIL"} (${JSON.stringify({ maxPingMs: idle.maxPingMs, flagged: idle.detectedAt !== null, idleMs: 2000 })})`;
    // Not awaited: the out-of-page leg watches the call that starts the loop as its first ping.
    const trigger = page.evaluate(([x, ms]) => window.__ff.busy(x, ms), [v, BUSY_MS]);
    const outside = await watchOutOfPage(() => page.evaluate(() => 1), BUSY_MS + 1500, trigger);
    await until("busy loop over", () => page.evaluate((x) => window.__ff.watch(x).busyEnd !== null, v));
    const inside = await page.evaluate((x) => window.__ff.watch(x), v);

    await page.evaluate(() => window.__ff.navigateTest());
    await new Promise((r) => setTimeout(r, 1500));
    const asked = await page.evaluate(() => window.__ff.refreshHits());
    await until("hits read", () => page.evaluate((t) => window.__ff.hitsAt >= t, asked));
    const graded = await page.evaluate((w) => window.__ff.grade(w, true), name);

    const start = inside.busyStart ?? inside.busyAsked;
    const inPage = inside.flaggedAt === null ? null : inside.flaggedAt - start;
    const outOfPage = outside.detectedAt === null ? null : outside.detectedAt - start;
    const both = [inPage, outOfPage].filter((x) => x !== null);
    const detected = both.length ? Math.min(...both) : null;
    const ok = detected !== null && detected <= DETECT_BUDGET_MS;
    const detail = {
      inPageMs: inPage,
      outOfPageMs: outOfPage,
      parentMaxGapMs: inside.maxGap,
      maxPingMs: outside.maxPingMs,
      busyMs: BUSY_MS,
    };
    graded.lines.push(
      `FRAME ${name} ${v} watchdog detected within ${DETECT_BUDGET_MS} ms: ${ok ? "ok" : "FAIL"} (${JSON.stringify(detail)})`,
    );
    if (!ok) graded.failed.push("watchdog");
    graded.lines.push(idleLine);
    if (!idleOk) graded.failed.push("watchdog idle");
    for (const l of graded.lines) console.log(l);
    failed += graded.failed.length;
    await browser.close();
  }
} finally {
  await harness.close();
}
console.log(failed ? `FRAME ${failed} check(s) failed` : "FRAME all checks ok");
process.exit(failed ? 1 : 0);
