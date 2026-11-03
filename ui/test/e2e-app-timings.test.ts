// @vitest-environment node
// D-154: every real-app run reports each flow's wall time and how often @wdio/tauri-service's
// window-focus check stalled in it (tests/e2e/support/timings.ts, wired in wdio.conf.ts).

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { countStalls, flowName, STALL, summaryTable, timings } from "../../tests/e2e/support/timings";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("e2e-app flow times (D-154)", () => {
  it("names a flow by its spec file, with or without a file:// URL", () => {
    expect(flowName("/w/tests/e2e/flows/idle.ts")).toBe("idle");
    expect(flowName("file:///w/tests/e2e/flows/open-course.ts")).toBe("open-course");
    expect(flowName("C:\\w\\tests\\e2e\\flows\\cold-open.ts".replaceAll("\\", "/"))).toBe("cold-open");
  });

  it("counts the service's 5 s focus-check waits in a worker log", () => {
    const warn = `WARN tauri-service:window: Failed to get window states: Error: Tauri ${STALL} after 5s timeout`;
    expect(countStalls("")).toBe(0);
    expect(countStalls("INFO nothing to see\n")).toBe(0);
    expect(countStalls([warn, "INFO x", warn, warn].join("\n"))).toBe(3);
  });

  it("tables the flows slowest first, with the total and failures marked", () => {
    const table = summaryTable(
      [
        { flow: "shell", seconds: 12, passed: true, stalls: 0 },
        { flow: "idle", seconds: 190, passed: false, stalls: 4 },
        { flow: "ime", seconds: 30, passed: true, stalls: null },
      ],
      "e2e-app flow times (linux)",
    );
    expect(table.split("\n")).toEqual([
      "",
      "#### e2e-app flow times (linux)",
      "",
      "| flow | result | seconds | focus-check stalls |",
      "|---|---|---:|---:|",
      "| idle | FAIL | 190 | 4 |",
      "| ime | pass | 30 | ? |",
      "| shell | pass | 12 | 0 |",
      "| **all** | | **232** | **4** |",
      "",
    ]);
  });

  it("times each worker from start to end and writes timings.json and the summary", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const out = mkdtempSync(join(tmpdir(), "lecter-timings-"));
    const summary = join(out, "summary.md");
    writeFileSync(join(out, "wdio-0-1.log"), `a ${STALL} b ${STALL}\n`);
    const t = timings(out, summary, "flows");
    vi.setSystemTime(1_000_000);
    t.onWorkerStart("0-0", {}, ["/w/tests/e2e/flows/shell.ts"]);
    t.onWorkerStart("0-1", {}, ["/w/tests/e2e/flows/idle.ts"]);
    vi.setSystemTime(1_000_000 + 12_400);
    t.onWorkerEnd("0-0", 0);
    vi.setSystemTime(1_000_000 + 190_600);
    t.onWorkerEnd("0-1", 1);
    t.onWorkerEnd("9-9", 0); // never started: ignored
    t.onComplete();
    expect(JSON.parse(readFileSync(join(out, "timings.json"), "utf8"))).toEqual([
      { flow: "shell", seconds: 12, passed: true, stalls: null },
      { flow: "idle", seconds: 191, passed: false, stalls: 2 },
    ]);
    expect(readFileSync(summary, "utf8")).toContain("| idle | FAIL | 191 | 2 |");
  });
});
