// How long each flow took, for every real-app run (D-154). wdio.conf.ts wires these launcher hooks:
// a flow runs in its own worker, so worker start → end is the flow's wall time, app launch and
// teardown included. At the end the run prints one line per flow, writes them to timings.json in
// LECTER_E2E_OUT (scripts/e2e-app.sh keeps it in .verify/e2e-app/) and, on CI, adds a table to the
// job summary: a passing stage prints only PASS, so the summary is where the numbers show.
//
// It also counts @wdio/tauri-service's window-focus stalls in each worker's log: a 5 s wait before
// a find or click when the service can't reach `window.__wdio_original_core__` (support/window.ts
// switches that check off). A count above 0 means the switch didn't take.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

/** What the service logs after each 5 s wait (`Failed to get window states: …`). */
export const STALL = "core.invoke not available";

export interface FlowTime {
  flow: string;
  seconds: number;
  passed: boolean;
  /** Focus-check stalls in the flow's worker log; null when the log wasn't found. */
  stalls: number | null;
}

/** `tests/e2e/flows/idle.ts` → `idle`. */
export function flowName(spec: string): string {
  return basename(spec.replace(/^file:\/\//, "")).replace(/\.ts$/, "");
}

/** How many times the service's focus check stalled in one worker log. */
export function countStalls(log: string): number {
  return log.split(STALL).length - 1;
}

/** The job-summary table: slowest flow first, then the total. */
export function summaryTable(times: FlowTime[], title: string): string {
  const rows = [...times].sort((a, b) => b.seconds - a.seconds);
  const total = rows.reduce((s, t) => s + t.seconds, 0);
  const lines = [
    `\n#### ${title}\n`,
    "| flow | result | seconds | focus-check stalls |",
    "|---|---|---:|---:|",
    ...rows.map((t) => `| ${t.flow} | ${t.passed ? "pass" : "FAIL"} | ${t.seconds} | ${t.stalls ?? "?"} |`),
    `| **all** | | **${total}** | **${rows.reduce((s, t) => s + (t.stalls ?? 0), 0)}** |`,
    "",
  ];
  return lines.join("\n");
}

/** The launcher hooks; `out` is LECTER_E2E_OUT (worker logs), `summary` GITHUB_STEP_SUMMARY. */
export function timings(out: string | undefined, summary: string | undefined, title: string) {
  const started = new Map<string, { flow: string; at: number }>();
  const times: FlowTime[] = [];
  return {
    onWorkerStart(cid: string, _caps: unknown, specs: string[]): void {
      started.set(cid, { flow: flowName(specs[0] ?? cid), at: Date.now() });
    },
    onWorkerEnd(cid: string, exitCode: number): void {
      const s = started.get(cid);
      if (!s) return;
      const log = out ? join(out, `wdio-${cid}.log`) : "";
      const stalls = log && existsSync(log) ? countStalls(readFileSync(log, "utf8")) : null;
      times.push({ flow: s.flow, seconds: Math.round((Date.now() - s.at) / 1000), passed: exitCode === 0, stalls });
    },
    onComplete(): void {
      for (const t of times) {
        console.log(`flow-time ${t.flow} ${t.seconds}s ${t.passed ? "pass" : "FAIL"} stalls=${t.stalls ?? "?"}`);
      }
      if (out) writeFileSync(join(out, "timings.json"), `${JSON.stringify(times, null, 2)}\n`);
      if (summary) appendFileSync(summary, summaryTable(times, title));
    },
  };
}
