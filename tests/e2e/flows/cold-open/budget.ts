// The cold_open_ms gate (D-152): per-OS targets, a measurement is the median of 5 launches, and
// the median is gated at ×1 against its OS's target, locally and on CI. There is no ×1.5 allowance
// and no re-measure for this budget: the median and the 10 % margin in each target replace them.
// Plain functions, so ui/test/cold-open-budget.test.ts can check them without the app.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Launches per measurement (D-152). */
export const LAUNCHES = 5;

/** The CI runner targets live with the other budgets: tests/perf/budgets.json, cold_open_ms `per_os` (D-156). */
function ciTargets(): Partial<Record<NodeJS.Platform, number>> {
  const file = fileURLToPath(new URL("../../../perf/budgets.json", import.meta.url));
  const data = JSON.parse(readFileSync(file, "utf8")) as { budgets: { id: string; per_os?: Record<string, number> }[] };
  const targets = data.budgets.find((b) => b.id === "cold_open_ms")?.per_os;
  if (!targets) throw new Error(`${file}: cold_open_ms has no per_os targets`);
  return targets;
}

/**
 * The cold_open_ms target per OS (`process.platform`), in ms. Each is the first release-build
 * median on that OS's CI runner plus 10 %, rounded up to the next 10 ms (`targetFrom`); targets
 * only go down afterwards. Linux: median 973 on ubuntu-24.04 (F-179, CI run 41588635437) → 1080.
 * macOS's and Windows's come from F-025's dispatch run (D-152).
 */
export const TARGETS: Partial<Record<NodeJS.Platform, number>> = ciTargets();

/** The median of `xs` (an odd count, as LAUNCHES is; for an even count, the mean of the middle two). */
export function median(xs: number[]): number {
  if (xs.length === 0) throw new Error("median of no values");
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** A target from a first measurement: median + 10 %, rounded up to the next 10 ms (D-152). */
export function targetFrom(measuredMedian: number): number {
  // × 11 / 100 rather than × 1.1 / 10, and a hair under the boundary, so 300 gives 330, not 340.
  return Math.ceil((measuredMedian * 11) / 100 - 1e-9) * 10;
}

/** What one measurement means for the gate. */
export interface Verdict {
  /** "report": no target for this OS yet (passes); "pass": under it; "fail": at or over it. */
  outcome: "report" | "pass" | "fail";
  /** The lines the flow prints: the median with every launch, then REPORT when there's no target. */
  lines: string[];
}

/** Gates the launches' median against `os`'s target in `targets`. */
export function verdict(values: number[], os: string, targets: Partial<Record<string, number>> = TARGETS): Verdict {
  const m = median(values).toFixed(0);
  const all = values.map((v) => v.toFixed(0)).join(" ");
  const target = targets[os];
  const summary = `cold_open_ms ${m} (median of ${values.length}: ${all}; target ${target ?? "none"} for ${os})`;
  if (target === undefined) {
    return { outcome: "report", lines: [summary, `REPORT cold_open_ms ${m} (no ${os} target yet, D-152)`] };
  }
  return { outcome: median(values) < target ? "pass" : "fail", lines: [summary] };
}
