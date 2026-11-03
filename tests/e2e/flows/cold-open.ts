// F-179: cold open under budget (14-quality.md#performance-budgets, cold_open_ms < 400 ms).
// The flow builds the release app with test hooks (cold-open/launch.ts), closes the service's
// debug app and starts the release one itself, so it knows when the process started. Then, in
// the page, it opens the course and the 200-slide fixture lecture with no time for the user's
// clicks: cold_open_ms = process start → the shell's first paint, plus Open course folder → the
// frame that shows the lecture's buffer (the measurement D-139 started from).
//
// Checked per launch:
// - criterion 1: the app logs `startup <phase> <ms>` once per phase, in order; on Linux, where it
//   counts from the OS's process start, its shell line agrees with the page's own clock;
// - criterion 3: every resource other than index.html's own script and stylesheet starts loading
//   after the shell's first paint (the UI's IPC order is covered by ui/src/App.startup.test.tsx);
// - criterion 2: under 400 ms, or on CI under 400 × 1.5 = 600 ms, measured once more on a breach
//   and failing only if both launches are over. It gates on Linux (the criterion's ubuntu-24.04
//   runner); elsewhere the value is reported.
// Every launch prints its breakdown before anything is asserted, so a failing run still says
// where the time went.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shot } from "../support/shot.ts";
import {
  APP,
  alive,
  buildRelease,
  type Launch,
  LECTURE,
  launch,
  PHASES,
  type Phase,
  startupLines,
  stop,
  waitFor,
} from "./cold-open/launch.ts";
import { openInPage, type PageTimes } from "./cold-open/page.ts";

const BUDGET_MS = 400;
/** 14-quality.md#performance-budgets: timing budgets get ×1.5 on shared CI runners. */
const CI_ALLOWANCE = 1.5;
const ON_CI = Boolean(process.env.CI);
const LIMIT_MS = ON_CI ? BUDGET_MS * CI_ALLOWANCE : BUDGET_MS;
const GATES = process.platform === "linux";
/** How far the app's shell line may sit from the page's own clock (start known to 10 ms; IPC). */
const AGREE_MS = 100;

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The script and stylesheets ui/dist/index.html loads itself: the only work before the paint. */
function entryFiles(): string[] {
  const html = readFileSync(join(root, "ui", "dist", "index.html"), "utf8");
  return [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map((m) => m[1] as string);
}

interface Run {
  n: number;
  page: PageTimes;
  /** Process start → the shell's first paint, from the page's mark (or its first contentful paint). */
  shellMs: number;
  coldOpenMs: number;
  lines: Partial<Record<Phase, number>>;
}

function breakdown(r: Run): string {
  const p = r.page;
  const fmt = (t: number | null) => (t === null ? "n/a" : t.toFixed(0));
  const logged = PHASES.map((ph) => `${ph} ${r.lines[ph] ?? "missing"}`).join(", ");
  return (
    `cold-open run ${r.n}: cold_open_ms ${r.coldOpenMs.toFixed(0)} (limit ${LIMIT_MS}) = ` +
    `shell first paint ${r.shellMs.toFixed(0)} + open ${p.openMs.toFixed(0)} ` +
    `(course listed ${p.courseMs.toFixed(0)}, lecture in the DOM ${p.lectureDomMs.toFixed(0)}, ` +
    `painted ${(p.openMs - p.courseMs - p.lectureDomMs).toFixed(0)}); ` +
    `app log since process start: ${logged}; ` +
    `page since its time origin: response ${fmt(p.responseEnd)}, DOMContentLoaded ${fmt(p.domContentLoaded)}, ` +
    `load ${fmt(p.loadEnd)}, first contentful paint ${fmt(p.fcp)}, shell mark ${fmt(p.shellMark)}; ` +
    `resources: ${p.resources.map((x) => `${x.name}@${x.start.toFixed(0)}`).join(" ")}`
  );
}

let current: Launch | null = null;

/** Launches the release app, opens the fixture lecture and reads the app's startup lines. */
async function measure(n: number): Promise<Run> {
  current = await launch(n);
  const page = await openInPage(LECTURE);
  const shellAt = page.shellMark ?? page.fcp ?? Number.NaN;
  const shellMs = page.timeOrigin + shellAt - current.spawnedAt;
  // The paints reach the core by IPC right after them: give the buffer's line a moment.
  const log = current.log;
  await waitFor(async () => "buffer-first-paint" in startupLines(readFileSync(log, "utf8")), 5_000, "the log").catch(
    () => undefined,
  );
  const run = {
    n,
    page,
    shellMs,
    coldOpenMs: shellMs + page.openMs,
    lines: startupLines(readFileSync(log, "utf8")),
  };
  console.log(breakdown(run));
  if (n === 1) await shot("cold-open");
  return run;
}

/** Criteria 1 and 3 on one launch. */
function check(r: Run, entry: string[]): void {
  // Criterion 1: one line per phase, in the order the phases happen.
  const missing = PHASES.filter((ph) => r.lines[ph] === undefined);
  expect(missing).toEqual([]);
  const ms = PHASES.map((ph) => r.lines[ph] as number);
  expect(ms).toEqual([...ms].sort((a, b) => a - b));
  expect(r.page.shellMark).not.toBeNull();
  if (GATES) {
    // Counted from the OS's process start, the app's shell line is the page's shell paint.
    expect(Math.abs((r.lines["shell-first-paint"] as number) - r.shellMs)).toBeLessThanOrEqual(AGREE_MS);
  }

  // Criterion 3: nothing but index.html's own files loads before the shell's first paint.
  const loaded = r.page.resources.map((x) => x.name);
  const seen = entry.filter((f) => loaded.includes(f));
  if (seen.length === 0) {
    console.log(`REPORT cold-open run ${r.n}: this webview lists no resource timing for index.html's files`);
    return;
  }
  const shell = r.page.shellMark as number;
  const early = r.page.resources.filter((x) => !entry.includes(x.name) && x.start < shell);
  expect(early).toEqual([]);
  // The buffer's own chunk is among the later ones: the deferral happened, not a bundle of one.
  expect(r.page.resources.some((x) => !entry.includes(x.name) && x.name.endsWith(".js"))).toBe(true);
}

describe("cold open", function () {
  // The release build takes minutes the first time; each launch then takes seconds.
  this.timeout(40 * 60_000);

  after(async () => {
    if (current) await stop(current);
    current = null;
  });

  it("opens the 200-slide lecture under budget and logs each startup phase", async () => {
    await buildRelease();
    const entry = entryFiles();
    expect(entry.length).toBeGreaterThan(0);

    // The service started the debug app; closing its window quits it and frees the port.
    await browser.closeWindow().catch(() => undefined);
    await waitFor(async () => !(await alive()), 30_000, "the debug app to quit");

    const runs = [await measure(1)];
    const first = runs[0] as Run;
    if (first.coldOpenMs >= LIMIT_MS) {
      // A breach is measured once more (14-quality.md#performance-budgets).
      await stop(current as Launch);
      current = null;
      runs.push(await measure(2));
    }
    console.log(
      `cold_open_ms ${runs.map((r) => r.coldOpenMs.toFixed(0)).join(" / ")} (budget ${BUDGET_MS}, limit ${LIMIT_MS}${ON_CI ? " on CI" : ""}; ${APP})`,
    );
    for (const r of runs) check(r, entry);
    const best = Math.min(...runs.map((r) => r.coldOpenMs));
    expect(Number.isFinite(best)).toBe(true);
    if (GATES) expect(best).toBeLessThan(LIMIT_MS);
    else console.log(`REPORT cold_open_ms ${best.toFixed(0)} on ${process.platform} (gates on Linux only)`);
  });
});
