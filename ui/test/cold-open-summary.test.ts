// @vitest-environment node
// F-179: the cold-open flow writes its lines to the CI job summary too, under one heading and as
// one indented code block (tests/e2e/flows/cold-open/summary.ts, as ime.ts does per D-141).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reporter } from "../../tests/e2e/flows/cold-open/summary";

let dir = "";
afterEach(() => {
  vi.restoreAllMocks();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("cold-open job summary", () => {
  it("appends every line under one heading, as a code block, after what the file held", () => {
    dir = mkdtempSync(join(tmpdir(), "cold-open-summary-"));
    const file = join(dir, "summary.md");
    writeFileSync(file, "earlier step\n");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const report = reporter(file);
    report("cold-open run 1/5: cold_open_ms 412 = shell first paint 350 + open 62");
    report("cold_open_ms 410 (median of 5: 412 405 410 420 399; target none for linux)");
    report("REPORT cold_open_ms 410 (no linux target yet, D-152)");
    expect(readFileSync(file, "utf8")).toBe(
      "earlier step\n" +
        "\n#### F-179 cold open (cold_open_ms, D-152)\n\n" +
        "    cold-open run 1/5: cold_open_ms 412 = shell first paint 350 + open 62\n" +
        "    cold_open_ms 410 (median of 5: 412 405 410 420 399; target none for linux)\n" +
        "    REPORT cold_open_ms 410 (no linux target yet, D-152)\n",
    );
    // The log gets the same lines.
    expect(log.mock.calls.map((c) => c[0])).toEqual([
      "cold-open run 1/5: cold_open_ms 412 = shell first paint 350 + open 62",
      "cold_open_ms 410 (median of 5: 412 405 410 420 399; target none for linux)",
      "REPORT cold_open_ms 410 (no linux target yet, D-152)",
    ]);
  });

  it("only logs when there is no job summary (local runs)", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    reporter(undefined)("REPORT cold-open not measured on darwin: this flow measures on Linux only (D-152)");
    reporter("")("x");
    expect(log).toHaveBeenCalledTimes(2);
  });
});
