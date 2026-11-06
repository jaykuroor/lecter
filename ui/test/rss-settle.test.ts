// @vitest-environment node
// F-181 / D-225: rss_300_slides_mb on macOS is the median of at least 3 samples, one after each
// 5 s settle, and the detail lists every sample; elsewhere one settle and the larger of the two
// samples counts (D-161). The measurement is tests/perf/app/rss-300.perf.ts.

import { describe, expect, it } from "vitest";
import { counted, SETTLE_MS, settles } from "../../tests/perf/app/settle";

describe("rss_300_slides_mb settles (D-161, D-225)", () => {
  it("samples macOS after at least 3 settles of 5 s, the other OSes after one", () => {
    expect(SETTLE_MS).toBe(5_000);
    expect(settles("darwin")).toBeGreaterThanOrEqual(3);
    expect(settles("linux")).toBe(1);
    expect(settles("win32")).toBe(1);
  });

  it("on macOS the median of the settles counts, not the transient at the scroll or one outlier", () => {
    // CI-like: 531 MB at the scroll, then a WebKit release that lands late in one settle.
    const c = counted("darwin", 531, [438, 230, 351]);
    expect(c.value).toBe(351);
    expect(c.from).toBe(3); // the third settle's snapshot: [at the scroll, settle 1, 2, 3]
    expect(c.detail).toBe(
      "531.0 MB at the scroll, then 438.0, 230.0, 351.0 MB after each 5 s settle (darwin: the median of 3 settles counts)",
    );
    expect(counted("darwin", 100, [300, 200, 250]).value).toBe(250);
    expect(counted("darwin", 900, [200, 200, 410]).value).toBe(200);
  });

  it("elsewhere the larger of the scroll and the one settle counts", () => {
    const up = counted("linux", 440.25, [451.5]);
    expect([up.value, up.from]).toEqual([451.5, 1]);
    expect(up.detail).toBe(
      "440.3 MB at the scroll, then 451.5 MB after each 5 s settle (the larger of the two counts)",
    );
    const down = counted("win32", 170, [150]);
    expect([down.value, down.from]).toEqual([170, 0]);
    expect(counted("linux", 300, [300]).from).toBe(1);
  });

  it("refuses a sample count that doesn't match the OS's settles", () => {
    expect(() => counted("darwin", 500, [400])).toThrow(/3 settles/);
    expect(() => counted("darwin", 500, [400, 410])).toThrow(/3 settles/);
    expect(() => counted("linux", 500, [])).toThrow(/1 settle/);
  });
});
