// The idle attribution run (F-180, D-161; 14-quality.md#performance-budgets, idle_cpu_pct): the
// release app opens the 200-slide fixture lecture, settles for a minute (as F-025's idle run
// does), then stays idle for 5 minutes while every app process and thread is sampled every 15 s
// and the page counts its frames, mutations and animations. It prints all of it as the
// `idle-attribution` lines and returns idle_cpu_pct over the window.

import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openInPage } from "../cold-open/page.ts";
import { installCounters, type PageCounts, pageLines, readCounters } from "./counters.ts";
import { APP, LECTURE, startRelease, stopRelease } from "./release.ts";
import { sample } from "./sample.ts";
import { cpuLines, cpuPct, series } from "./threads.ts";

/** After the lecture opens: long enough for the caret's 10 s and any settling (F-025's 60 s). */
export const SETTLE_MS = 60_000;
/** The idle_cpu_pct window (14-quality.md#performance-budgets: a 5-minute idle sample). */
export const WINDOW_MS = 300_000;
/** One CPU sample per process and thread every this often. */
export const STEP_MS = 15_000;

/**
 * A `report(line)` that prints the line, keeps it for `idle-attribution.log` and, on CI, adds it
 * to the job summary (a passing stage shows no log, D-154).
 */
export function reporter(summary = process.env.GITHUB_STEP_SUMMARY): {
  report: (line: string) => void;
  lines: string[];
} {
  const lines: string[] = [];
  return {
    lines,
    report(line) {
      console.log(line);
      if (summary)
        appendFileSync(summary, `${lines.length === 0 ? "\n#### F-180 idle attribution\n\n" : ""}    ${line}\n`);
      lines.push(line);
    },
  };
}

export interface Attribution {
  pct: number;
  page: PageCounts;
}

/**
 * Runs the whole measurement: starts the release app, opens the lecture, settles, samples the
 * window, reports, and stops the app.
 */
export async function attribute(report: (line: string) => void): Promise<Attribution> {
  const app = await startRelease(report);
  try {
    await openInPage(LECTURE);
    await installCounters();
    await browser.pause(SETTLE_MS);
    const from = Date.now();
    const samples = await sample(APP, WINDOW_MS, STEP_MS);
    const to = Date.now();
    const page = await readCounters(from, to, STEP_MS);
    const s = series(samples);
    report(
      `idle-attribution setup: ${process.platform}, ${APP}, ${LECTURE} (200 slides) open, settled ${SETTLE_MS / 1000} s, then idle ${WINDOW_MS / 1000} s`,
    );
    for (const line of cpuLines(s, STEP_MS / 1000)) report(line);
    for (const line of pageLines(page)) report(line);
    return { pct: cpuPct(s), page };
  } finally {
    await stopRelease(app);
  }
}

/** Saves the lines as idle-attribution.log beside the run's logs (LECTER_E2E_OUT). */
export function save(lines: string[]): void {
  const out = process.env.LECTER_E2E_OUT;
  if (out) writeFileSync(join(out, "idle-attribution.log"), `${lines.join("\n")}\n`);
}
