// F-179: cold open (14-quality.md#performance-budgets, cold_open_ms; per-OS targets, D-152).
// The flow builds the release app with test hooks (cold-open/launch.ts), closes the service's
// debug app and starts the release one itself, so it knows when the process started. Then, in
// the page, it opens the course and the 200-slide fixture lecture with no time for the user's
// clicks: cold_open_ms = process start → the shell's first paint, plus Add a course → the
// frame that shows the lecture's buffer (the measurement D-139 started from).
//
// A measurement is the median of 5 launches (D-152), each a fresh process with a fresh home and
// course, started only once the previous app's processes have all ended (cold-open/quiet.ts).
// Checked on every launch:
// - criterion 1: the app logs `startup <phase> <ms>` once per phase, in order; on Linux, where it
//   counts from the OS's process start, its shell line agrees with the page's own clock;
// - criterion 3: every resource other than index.html's own script and stylesheet starts loading
//   after the shell's first paint (the UI's IPC order is covered by ui/src/App.startup.test.tsx).
// Criterion 2: the median is gated at ×1 against its OS's target (cold-open/budget.ts) off CI; on
// CI (a shared VM runner) the median of the 5 launches prints REPORT and never fails (D-225,
// F-181); an OS without a target yet prints REPORT and passes. Only Linux builds and measures
// (the criterion's ubuntu-24.04 runner); macOS and Windows targets come from F-025's perf run, so
// there the flow builds nothing and says so.
// The app's own buffer-first-paint line is checked for order only; the gated value is the page's.
// Every launch prints its breakdown before anything is asserted, so a failing run still says
// where the time went.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shot } from "../support/shot.ts";
import { LAUNCHES, onCi, TARGETS, verdict } from "./cold-open/budget.ts";
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
import { processTree, quiet } from "./cold-open/quiet.ts";
import { reporter } from "./cold-open/summary.ts";

/** Prints a line, and on CI also adds it to the job summary (a passing stage shows no log). */
const report = reporter(process.env.GITHUB_STEP_SUMMARY);

/** Only Linux builds and measures here (the criterion's ubuntu-24.04 runner). */
const MEASURES = process.platform === "linux";
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
  /** Process start → the page's time origin (its navigation start). */
  navigationMs: number;
  coldOpenMs: number;
  lines: Partial<Record<Phase, number>>;
}

function breakdown(r: Run): string {
  const p = r.page;
  const fmt = (t: number | null) => (t === null ? "n/a" : t.toFixed(0));
  const logged = PHASES.map((ph) => `${ph} ${r.lines[ph] ?? "missing"}`).join(", ");
  return (
    `cold-open run ${r.n}/${LAUNCHES}: cold_open_ms ${r.coldOpenMs.toFixed(0)} = ` +
    `shell first paint ${r.shellMs.toFixed(0)} + open ${p.openMs.toFixed(0)} ` +
    `(course listed ${p.courseMs.toFixed(0)}, lecture in the DOM ${p.lectureDomMs.toFixed(0)}, ` +
    `painted ${(p.openMs - p.courseMs - p.lectureDomMs).toFixed(0)}); ` +
    `app log since process start: ${logged}; ` +
    `page navigation start since process start ${r.navigationMs.toFixed(0)}; page since its time origin: response ${fmt(p.responseEnd)}, DOMContentLoaded ${fmt(p.domContentLoaded)}, ` +
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
    navigationMs: page.timeOrigin - current.spawnedAt,
    coldOpenMs: shellMs + page.openMs,
    lines: startupLines(readFileSync(log, "utf8")),
  };
  report(breakdown(run));
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
  // Counted from the OS's process start (Linux), the app's shell line is the page's shell paint.
  expect(Math.abs((r.lines["shell-first-paint"] as number) - r.shellMs)).toBeLessThanOrEqual(AGREE_MS);

  // Criterion 3: nothing but index.html's own files loads before the shell's first paint.
  const loaded = r.page.resources.map((x) => x.name);
  const seen = entry.filter((f) => loaded.includes(f));
  if (seen.length === 0) {
    report(`REPORT cold-open run ${r.n}: this webview lists no resource timing for index.html's files`);
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
    if (current) await stop(current, true);
    current = null;
  });

  it("opens the 200-slide lecture under its OS's target and logs each startup phase", async () => {
    if (!MEASURES) {
      // A release build here would cost the job minutes; this OS's value and target come from
      // the perf stage (F-025, D-152).
      report(`REPORT cold-open not measured on ${process.platform}: this flow measures on Linux only (D-152)`);
      return;
    }
    const building = Date.now();
    await buildRelease();
    report(`cold-open: the release app built in ${Math.round((Date.now() - building) / 1000)} s`);
    const entry = entryFiles();
    expect(entry.length).toBeGreaterThan(0);

    // The service started the debug app; closing its window quits it and frees the port. The
    // timed launch starts only once it and every process it started (WebKit's) have ended, so
    // its teardown doesn't share the CPU with the launch being measured.
    const debugBinary = join(root, "target", "debug", "lecter-app");
    const debugApp = processTree(debugBinary);
    expect(debugApp.length).toBeGreaterThan(0);
    const closed = Date.now();
    await browser.closeWindow().catch(() => undefined);
    await waitFor(async () => !(await alive()), 30_000, "the debug app to quit");
    await quiet(debugBinary, debugApp, "the debug app");
    report(
      `cold-open: the debug app's ${debugApp.length} processes ended ${Date.now() - closed} ms after its window closed`,
    );

    // Five launches, one after the other; stop() waits for each one's processes to end.
    const runs: Run[] = [];
    for (let n = 1; n <= LAUNCHES; n++) {
      runs.push(await measure(n));
      await stop(current as Launch, n === LAUNCHES);
      current = null;
    }
    const v = verdict(
      runs.map((r) => r.coldOpenMs),
      process.platform,
      TARGETS,
      onCi(process.env),
    );
    for (const line of v.lines) report(line);
    report(`cold-open: ${APP}; targets ${JSON.stringify(TARGETS)}`);
    for (const r of runs) check(r, entry);
    expect(runs.every((r) => Number.isFinite(r.coldOpenMs))).toBe(true);
    expect(v.outcome).not.toBe("fail");
  });
});
