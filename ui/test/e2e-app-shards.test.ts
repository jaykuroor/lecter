// @vitest-environment node
// D-154: CI splits the real-app flows into parallel shards (tests/e2e/support/shards.ts). Every
// flow runs in exactly one shard, cold-open runs alone on Linux (it times cold starts on a quiet
// machine, D-152), and the rest are balanced by measured seconds.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALONE, parseShard, plan, SECONDS } from "../../tests/e2e/support/shards";

const flows = readdirSync(join(__dirname, "..", "..", "tests", "e2e", "flows"))
  .filter((f) => f.endsWith(".ts"))
  .map((f) => f.slice(0, -3))
  .sort();
const sum = (s: string[], os: string) => s.reduce((t, f) => t + (SECONDS[os]?.[f] ?? 0), 0);

describe("e2e-app shards (D-154)", () => {
  it("reads <i>/<n> and refuses anything else", () => {
    expect(parseShard("2/4")).toEqual({ index: 2, total: 4 });
    expect(parseShard(" 1/1 ")).toEqual({ index: 1, total: 1 });
    for (const bad of ["", "0/4", "5/4", "2", "2/0", "a/b", "-1/4", "1/4/2"]) {
      expect(() => parseShard(bad), bad).toThrow(/LECTER_E2E_SHARD/);
    }
  });

  it("puts every flow in exactly one shard on every OS, none empty", () => {
    for (const os of ["linux", "darwin", "win32"]) {
      for (let n = 2; n <= flows.length; n++) {
        const shards = plan(flows, os, n);
        expect(shards).toHaveLength(n);
        expect(shards.every((s) => s.length > 0)).toBe(true);
        expect(shards.flat().sort()).toEqual(flows);
      }
    }
  });

  it("runs cold-open alone on Linux, and only there", () => {
    expect(ALONE).toEqual({ linux: ["cold-open"] });
    expect(plan(flows, "linux", 3)[0]).toEqual(["cold-open"]);
    expect(plan(flows, "darwin", 3).some((s) => s.includes("cold-open") && s.length > 1)).toBe(true);
    expect(() => plan(flows, "linux", 1)).toThrow(/no room beside cold-open/);
    expect(plan(["cold-open"], "linux", 1)).toEqual([["cold-open"]]);
  });

  it("balances by measured seconds, slowest first to the lightest shard", () => {
    const os = "test-os";
    SECONDS[os] = { a: 100, b: 60, c: 50, d: 40, e: 10 };
    try {
      // a → 1; b → 2; c → 2 (60 < 100); d → 1 (100 < 110); e → 2 (110 < 140).
      expect(plan(["e", "d", "c", "b", "a"], os, 2)).toEqual([
        ["a", "d"],
        ["b", "c", "e"],
      ]);
      // A flow with no measured time counts as the slowest known one (100 s): a → 1, new → 2,
      // b → 1 (a tie goes to the earlier shard). Counted light, it would have joined b instead.
      expect(plan(["a", "b", "new"], os, 2)).toEqual([["a", "b"], ["new"]]);
      // Equal times go by name, so every runner agrees on the plan.
      SECONDS[os] = { x: 5, y: 5, z: 5 };
      expect(plan(["z", "y", "x"], os, 3)).toEqual([["x"], ["y"], ["z"]]);
    } finally {
      delete SECONDS[os];
    }
  });

  it("refuses more shards than flows", () => {
    expect(() => plan(["a", "b"], "darwin", 3)).toThrow(/2 flows can't fill 3 shards/);
  });

  it("keeps the measured shards close: the slowest shard is within the slowest flow of the mean", () => {
    for (const os of ["linux", "darwin", "win32"]) {
      const known = SECONDS[os] ?? {};
      if (Object.keys(known).length === 0) continue;
      const n = 4;
      const shards = plan(flows, os, n);
      const loads = shards.map((s) => sum(s, os));
      const mean = loads.reduce((a, b) => a + b, 0) / n;
      expect(Math.max(...loads), os).toBeLessThanOrEqual(mean + Math.max(...Object.values(known)));
    }
  });
});
