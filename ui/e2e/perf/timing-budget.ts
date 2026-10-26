// The timing rule of 14-quality.md#performance-budgets for Playwright perf checks: shared CI
// runners are noisy, so under CI a timing value gets a ×1.5 allowance, and a value over it is
// measured once more; the check fails only if both runs are over ×1.5, and the report keeps both
// values. Locally it gates at ×1, on one run. The budget itself comes from
// tests/perf/budgets.json (protected; F-025 creates it) when the entry exists, else from the spec
// value the caller passes.

import { existsSync, readFileSync } from "node:fs";

/** The allowance a timing budget gets on CI. */
export const CI_ALLOWANCE = 1.5;

/** A budget value and where it came from, for the report line. */
export interface Budget {
  value: number;
  /** `budgets.json` or `spec`. */
  source: string;
  /** Whether the ×1.5 CI rule applies (`kind: timing`). */
  timing: boolean;
}

interface Entry {
  id?: unknown;
  budget?: unknown;
  kind?: unknown;
}

function entries(json: unknown): Entry[] {
  if (Array.isArray(json)) return json as Entry[];
  const listed = (json as { budgets?: unknown } | null)?.budgets;
  if (Array.isArray(listed)) return listed as Entry[];
  throw new Error("budgets.json: expected an array of budgets or { budgets: [...] }");
}

/**
 * The budget `id` from the budgets file at `file`, or `specValue` (a timing budget) when the file
 * or its entry doesn't exist yet. A file or entry that exists but doesn't parse is an error, never
 * a silent fallback.
 */
export function readBudget(file: string, id: string, specValue: number): Budget {
  if (!existsSync(file)) return { value: specValue, source: "spec", timing: true };
  const entry = entries(JSON.parse(readFileSync(file, "utf8"))).find((e) => e.id === id);
  if (!entry) return { value: specValue, source: "spec", timing: true };
  if (typeof entry.budget !== "number" || !Number.isFinite(entry.budget)) {
    throw new Error(`budgets.json: ${id} has no numeric budget`);
  }
  return { value: entry.budget, source: "budgets.json", timing: entry.kind === "timing" };
}

/** The value a measurement must stay under: ×1.5 for a timing budget on CI, else the budget. */
export function limitOf(budget: Budget, ci: boolean): number {
  return ci && budget.timing ? budget.value * CI_ALLOWANCE : budget.value;
}

/** Whether to measure once more: only on CI, for a timing budget, after one run over its limit. */
export function remeasure(values: readonly number[], budget: Budget, ci: boolean): boolean {
  const [first] = values;
  return ci && budget.timing && values.length === 1 && first !== undefined && !(first < limitOf(budget, ci));
}

/** Whether the check passes: some run stayed under the limit (on CI, at most two runs count). */
export function passes(values: readonly number[], budget: Budget, ci: boolean): boolean {
  const limit = limitOf(budget, ci);
  const counted = ci && budget.timing ? values.slice(0, 2) : values.slice(0, 1);
  return counted.length > 0 && counted.some((v) => v < limit);
}
