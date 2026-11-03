// @vitest-environment node
// F-180: the idle attribution's arithmetic (tests/e2e/flows/idle-cpu/threads.ts), its gate
// (budget.ts: idle_cpu_pct < 0.5 % on Linux and macOS, REPORT on Windows, D-161), and the pure
// parts of the process and thread reader (tests/perf/idle_threads.py --selftest).

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GATED, IDLE_CPU_PCT, verdict } from "../../tests/e2e/flows/idle-cpu/budget";
import { cpuLines, cpuPct, type Proc, python, type Snapshot, series } from "../../tests/e2e/flows/idle-cpu/threads";

const ms = (x: number) => x * 1e6;

function proc(pid: number, name: string, cpu: number, threads: [number, string, number][]): Proc {
  return {
    pid,
    ppid: 1,
    name,
    cpu_ns: ms(cpu),
    threads: threads.map(([tid, n, c]) => ({ tid, name: n, cpu_ns: ms(c) })),
    threads_error: "",
  };
}

const snap = (t: number, procs: Proc[]): Snapshot => ({ os: "linux", now_ms: t, procs });

// Three samples 15 s apart: the web process's four llvmpipe threads draw in both intervals, the
// app is quiet in the second, a helper starts after the first sample and another ends.
const samples = [
  snap(0, [
    proc(10, "lecter-app", 100, [[10, "lecter-app", 90]]),
    proc(11, "WebKitWebProcess", 1000, [
      [11, "WebKitWebProcess", 500],
      [21, "llvmpipe-0", 100],
      [22, "llvmpipe-1", 100],
    ]),
    proc(12, "gone", 40, []),
  ]),
  snap(15_000, [
    proc(10, "lecter-app", 130, [[10, "lecter-app", 120]]),
    proc(11, "WebKitWebProcess", 1100, [
      [11, "WebKitWebProcess", 520],
      [21, "llvmpipe-0", 140],
      [22, "llvmpipe-1", 140],
    ]),
    proc(13, "WebKitNetworkProcess", 5, [[13, "WebKitNetworkProcess", 5]]),
  ]),
  snap(30_000, [
    proc(10, "lecter-app", 130, [[10, "lecter-app", 120]]),
    proc(11, "WebKitWebProcess", 1250, [
      [11, "WebKitWebProcess", 550],
      [21, "llvmpipe-0", 200],
      [22, "llvmpipe-1", 200],
      [23, "VBlankMonitor", 3],
    ]),
    proc(13, "WebKitNetworkProcess", 5, [[13, "WebKitNetworkProcess", 5]]),
  ]),
];

describe("idle attribution series", () => {
  it("gives each process's CPU per interval, busiest first, and sums threads of one name", () => {
    const s = series(samples);
    expect(s.seconds).toBe(30);
    expect(s.ended).toEqual(["gone[12]"]);
    expect(s.procs.map((p) => [p.name, p.ms, p.total])).toEqual([
      ["WebKitWebProcess", [100, 150], 250],
      ["lecter-app", [30, 0], 30],
      // Started after the first sample: counted from zero.
      ["WebKitNetworkProcess", [5, 0], 5],
    ]);
    const web = s.procs[0];
    expect(web?.threads.map((t) => [t.name, t.count, t.ms, t.total])).toEqual([
      ["llvmpipe-0", 1, [40, 60], 100],
      ["llvmpipe-1", 1, [40, 60], 100],
      ["WebKitWebProcess", 1, [20, 30], 50],
      // New in the last interval: all its time counts there.
      ["VBlankMonitor", 1, [0, 3], 3],
    ]);
  });

  it("sums threads that share a name, and counts how many there were", () => {
    const two = [
      snap(0, [
        proc(1, "app", 0, [
          [5, "tokio-runtime-worker", 10],
          [6, "tokio-runtime-worker", 10],
        ]),
      ]),
      snap(1000, [
        proc(1, "app", 30, [
          [5, "tokio-runtime-worker", 25],
          [6, "tokio-runtime-worker", 15],
        ]),
      ]),
    ];
    expect(series(two).procs[0]?.threads).toEqual([{ name: "tokio-runtime-worker", count: 2, ms: [20], total: 20 }]);
  });

  it("counts a thread under a reused id from zero, never negative", () => {
    const reused = [
      snap(0, [proc(1, "app", 100, [[7, "CVDisplayLink", 40]])]),
      snap(1000, [proc(1, "app", 103, [[7, "CVDisplayLink", 3]])]),
    ];
    expect(series(reused).procs[0]?.threads).toEqual([{ name: "CVDisplayLink", count: 1, ms: [3], total: 3 }]);
  });

  it("refuses a series of fewer than two samples", () => {
    expect(() => series([samples[0] as Snapshot])).toThrow(/two samples/);
  });

  it("gives idle_cpu_pct over all processes as a percent of one core", () => {
    // 285 ms of CPU over 30 s is 0.95 % of one core.
    expect(cpuPct(series(samples))).toBeCloseTo(0.95, 10);
  });

  it("prints every line as idle-attribution, threads under their process, the quiet ones left out", () => {
    const lines = cpuLines(series(samples), 15, 2, 4);
    expect(lines).toEqual([
      "idle-attribution cpu: idle_cpu_pct 0.95 = 285 ms over 30.0 s in 3 processes (ended meanwhile: gone[12]); series are ms per 15 s sample",
      "idle-attribution process WebKitWebProcess[11] 250 ms: 100 150",
      "idle-attribution   thread llvmpipe-0 100 ms: 40 60",
      "idle-attribution   thread llvmpipe-1 100 ms: 40 60",
      "idle-attribution   1 more threads 50 ms",
      "idle-attribution process lecter-app[10] 30 ms: 30 0",
      "idle-attribution   thread lecter-app 30 ms: 30 0",
      "idle-attribution process WebKitNetworkProcess[13] 5 ms: 5 0",
      "idle-attribution   thread WebKitNetworkProcess 5 ms: 5 0",
    ]);
  });

  it("says when a process's threads couldn't be read", () => {
    const blind = samples.map((s) => ({
      ...s,
      procs: s.procs.map((p) => ({ ...p, threads: [], threads_error: "refused" })),
    }));
    expect(cpuLines(series(blind), 15)).toContain("idle-attribution   threads unreadable: refused");
  });
});

describe("idle_cpu_pct gate (criterion 2, D-161)", () => {
  it("gates Linux and macOS below 0.5 % and reports Windows", () => {
    expect(IDLE_CPU_PCT).toBe(0.5);
    expect(GATED).toEqual(["linux", "darwin"]);
    expect(verdict(0.49, "linux")).toEqual({ outcome: "pass", line: "PASS idle_cpu_pct 0.49 < 0.5 on linux" });
    expect(verdict(0.5, "linux").outcome).toBe("fail");
    expect(verdict(3.7, "darwin")).toEqual({ outcome: "fail", line: "FAIL idle_cpu_pct 3.70 ≥ 0.5 on darwin" });
    expect(verdict(0.499, "darwin").outcome).toBe("pass");
    expect(verdict(0.57, "win32")).toEqual({
      outcome: "report",
      line: "REPORT idle_cpu_pct 0.57 (no gate on win32 yet, D-161)",
    });
  });
});

describe("process and thread reader (tests/perf/idle_threads.py)", () => {
  const reader = join(import.meta.dirname, "..", "..", "tests", "perf", "idle_threads.py");
  const self = JSON.parse(execFileSync(python(), [reader, "--selftest"], { encoding: "utf8" }));

  it("reads macOS's proc_bsdinfo, proc_threadinfo and rusage layouts", () => {
    expect(self.bsdinfo).toEqual([4321, 1, "com.apple.WebKit.WebContent", 1_700_000_000_250]);
    // pth_user_time + pth_system_time in ns, and the name cut at its NUL.
    expect(self.threadinfo).toEqual([3_500_000, "JavaScriptCore"]);
    // (300 + 200) mach units at Apple silicon's 125/3 timebase.
    expect(self.rusage_ns).toBe(20_833);
  });

  it("reads a Linux stat line whose command name holds spaces and brackets", () => {
    expect(self.linux_stat).toEqual(["Web (Content)", ["S", "7", "0", "0"]]);
  });

  it("groups the app, its descendants and the WebKit services charged to it or to nobody", () => {
    // 13 is a reused pid (older than its parent); 16 works for another live app; 18 is unrelated.
    expect(self.group).toEqual([10, 11, 14, 15, 12]);
  });
});
