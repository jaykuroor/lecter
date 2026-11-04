// @vitest-environment node
// F-179 / D-152: cold_open_ms is the median of 5 launches, gated at ×1 against its OS's target;
// an OS without a target reports and passes; a target is the first median + 10 %, rounded up to
// the next 10 ms. The flow is tests/e2e/flows/cold-open.ts.

import { describe, expect, it } from "vitest";
import { LAUNCHES, median, TARGETS, targetFrom, verdict } from "../../tests/e2e/flows/cold-open/budget";

describe("cold_open_ms gate (D-152)", () => {
  it("measures 5 launches and takes their median, in any order", () => {
    expect(LAUNCHES).toBe(5);
    expect(median([575, 336, 512, 330, 385])).toBe(385);
    expect(median([1, 2, 3])).toBe(2);
    expect(median([7])).toBe(7);
    // An outlier moves the mean, not the median.
    expect(median([400, 401, 402, 403, 9000])).toBe(402);
    expect(median([10, 20, 30, 40])).toBe(25);
    expect(() => median([])).toThrow();
  });

  it("Linux gates at 1080 ms (CI median 973 + 10 %, D-152); macOS and Windows at F-025's first dispatch medians + 10 %", () => {
    // The targets live in tests/perf/budgets.json (cold_open_ms per_os, D-156). macOS 2671.93 ms
    // (CI run 41702437408) and Windows 523.15 ms (CI run 41701063503), F-025's first measurements.
    expect(TARGETS).toEqual({ linux: targetFrom(973), darwin: targetFrom(2671.93), win32: targetFrom(523.15) });
    expect(TARGETS).toEqual({ linux: 1080, darwin: 2940, win32: 580 });
    expect(verdict([1079, 1200, 900, 1000, 1050], "linux").outcome).toBe("pass");
    expect(verdict([1080, 1200, 900, 1000, 1090], "linux").outcome).toBe("fail");
    expect(verdict([579, 600, 500, 520, 560], "win32").outcome).toBe("pass");
    expect(verdict([580, 600, 500, 590, 560], "win32").outcome).toBe("fail");
    expect(verdict([2939, 3000, 2000, 2100, 2200], "darwin").outcome).toBe("pass");
    expect(verdict([2940, 3000, 2000, 2950, 2200], "darwin").outcome).toBe("fail");
    // An OS without a target reports and passes.
    for (const os of ["darwin", "win32"]) {
      const v = verdict([484, 575, 420, 430, 440], os, { linux: 1080 });
      expect(v.outcome).toBe("report");
      expect(v.lines).toEqual([
        `cold_open_ms 440 (median of 5: 484 575 420 430 440; target none for ${os})`,
        `REPORT cold_open_ms 440 (no ${os} target yet, D-152)`,
      ]);
    }
  });

  it("gates the median at ×1 against its OS's target: under passes, equal or over fails", () => {
    const targets = { linux: 370 };
    expect(verdict([369, 500, 300, 360, 365], "linux", targets).outcome).toBe("pass");
    expect(verdict([370, 500, 300, 360, 380], "linux", targets).outcome).toBe("fail");
    expect(verdict([371, 500, 300, 360, 380], "linux", targets).outcome).toBe("fail");
    // No ×1.5 allowance: 1 ms over is a failure.
    expect(verdict([371, 371, 371, 371, 371], "linux", targets).lines).toEqual([
      "cold_open_ms 371 (median of 5: 371 371 371 371 371; target 370 for linux)",
    ]);
    // One OS's target doesn't gate another.
    expect(verdict([900, 900, 900, 900, 900], "darwin", targets).outcome).toBe("report");
  });

  it("sets a target at the first median + 10 %, rounded up to the next 10 ms", () => {
    expect(targetFrom(336)).toBe(370); // 369.6
    expect(targetFrom(300)).toBe(330); // exactly 330, not 340
    expect(targetFrom(320)).toBe(360); // 352
    expect(targetFrom(336.4)).toBe(380); // 370.04
    expect(targetFrom(500)).toBe(550);
  });
});
