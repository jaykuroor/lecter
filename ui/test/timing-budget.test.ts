// @vitest-environment node
// CI-a0174c9: the Playwright keystroke check gates by 14-quality.md#performance-budgets' timing
// rule: under CI a timing value gets a ×1.5 allowance, a value over it is measured once more, and
// the check fails only if both runs are over ×1.5; locally it gates at ×1 on one run. The budget
// comes from tests/perf/budgets.json when the entry exists.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Budget, limitOf, passes, readBudget, remeasure } from "../e2e/perf/timing-budget";

const timing: Budget = { value: 8, source: "spec", timing: true };
const exact: Budget = { value: 8, source: "budgets.json", timing: false };

describe("the timing rule", () => {
  it("gates at ×1 locally and ×1.5 on CI, for timing budgets only", () => {
    expect(limitOf(timing, false)).toBe(8);
    expect(limitOf(timing, true)).toBe(12);
    expect(limitOf(exact, true)).toBe(8);
  });

  it("locally, one run decides and is never re-measured", () => {
    expect(remeasure([9], timing, false)).toBe(false);
    expect(passes([7.9], timing, false)).toBe(true);
    expect(passes([8], timing, false)).toBe(false);
    expect(passes([9, 1], timing, false)).toBe(false);
  });

  it("on CI, a run over ×1.5 is measured once more, and only both over fail", () => {
    expect(remeasure([11.9], timing, true)).toBe(false);
    expect(passes([11.9], timing, true)).toBe(true);
    expect(remeasure([12], timing, true)).toBe(true);
    expect(remeasure([26.7], timing, true)).toBe(true);
    expect(remeasure([26.7, 13], timing, true)).toBe(false);
    expect(passes([26.7, 11], timing, true)).toBe(true);
    expect(passes([26.7, 12], timing, true)).toBe(false);
    expect(passes([13, 14, 1], timing, true)).toBe(false);
  });

  it("on CI, a non-timing budget is exact and never re-measured", () => {
    expect(remeasure([9], exact, true)).toBe(false);
    expect(passes([9], exact, true)).toBe(false);
    expect(passes([7], exact, true)).toBe(true);
  });

  it("no run is no pass", () => {
    expect(passes([], timing, true)).toBe(false);
    expect(passes([], timing, false)).toBe(false);
  });
});

describe("reading the budget", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  const file = (body: string) => {
    dir = mkdtempSync(join(tmpdir(), "budgets-"));
    const p = join(dir, "budgets.json");
    writeFileSync(p, body);
    return p;
  };

  it("uses the spec value while budgets.json doesn't exist", () => {
    expect(readBudget(join(tmpdir(), "no-such-dir", "budgets.json"), "keystroke_p99_ms", 8)).toEqual({
      value: 8,
      source: "spec",
      timing: true,
    });
  });

  it("takes the entry's budget and kind from budgets.json", () => {
    const entry = { id: "keystroke_p99_ms", budget: 6, unit: "ms", kind: "timing", script: "x" };
    const other = { id: "idle_rss_mb", budget: 150, kind: "memory" };
    expect(readBudget(file(JSON.stringify([other, entry])), "keystroke_p99_ms", 8)).toEqual({
      value: 6,
      source: "budgets.json",
      timing: true,
    });
    expect(readBudget(file(JSON.stringify({ budgets: [other] })), "idle_rss_mb", 1)).toEqual({
      value: 150,
      source: "budgets.json",
      timing: false,
    });
  });

  it("uses the spec value when budgets.json has no entry for the id", () => {
    expect(readBudget(file("[]"), "keystroke_p99_ms", 8)).toEqual({ value: 8, source: "spec", timing: true });
  });

  it("refuses a broken file or entry instead of falling back", () => {
    expect(() => readBudget(file("{"), "keystroke_p99_ms", 8)).toThrow();
    expect(() => readBudget(file('{"x":1}'), "keystroke_p99_ms", 8)).toThrow(/array of budgets/);
    expect(() => readBudget(file('[{"id":"keystroke_p99_ms","budget":"8"}]'), "keystroke_p99_ms", 8)).toThrow(
      /no numeric budget/,
    );
  });
});
