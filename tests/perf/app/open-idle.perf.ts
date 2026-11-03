// idle_rss_mb and idle_cpu_pct on the real app (14-quality.md#performance-budgets), in one fresh
// app process with the 200-slide fixture lecture:
// - idle_rss_mb: 60 s after the lecture opened, the memory of the app and its webview processes
//   (D-146: the app's RSS plus the webview's share; procs.ts).
// - idle_cpu_pct: then 5 minutes of idle, the CPU those processes used, as a percent of one core.
// The detail lines break memory down per process (both figures) and CPU per process (and, on
// Linux, per thread), to find what runs while idle (D-149).
// The waits send no WebDriver commands, so the embedded WebDriver server is idle too.

import { cpuUsed, memoryMb, snapshot } from "./procs.ts";
import { idle, lecture, openLecture, record, wanted } from "./support.ts";

const RSS_AFTER_MS = 60_000;
const CPU_WINDOW_MS = 300_000;

describe("open and idle", function () {
  this.timeout(RSS_AFTER_MS + CPU_WINDOW_MS + 180_000);

  it("measures idle memory and CPU after opening the lecture", async () => {
    await openLecture(lecture().name);

    await idle(RSS_AFTER_MS);
    const now = snapshot();
    // The webview runs in processes of its own: a group of one would miss most of the memory.
    expect(now.procs.some((p) => p.role === "webview")).toBe(true);
    const mem = memoryMb(now);
    if (wanted("idle_rss_mb"))
      record("idle_rss_mb", mem.total, `${now.procs.length} processes 60 s after open: ${mem.parts}`);
    if (!wanted("idle_cpu_pct")) return;

    const before = snapshot();
    const t0 = Date.now();
    await idle(CPU_WINDOW_MS);
    const after = snapshot();
    const seconds = (Date.now() - t0) / 1000;
    const cpu = cpuUsed(before, after);
    record(
      "idle_cpu_pct",
      (cpu.ms / 1000 / seconds) * 100,
      `${cpu.ms.toFixed(0)} ms CPU over ${seconds.toFixed(0)} s idle in ${after.procs.length} processes ` +
        `(${cpu.ended} ended); by process, busiest threads in brackets: ${cpu.parts}`,
    );
  });
});
