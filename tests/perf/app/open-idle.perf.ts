// idle_rss_mb and idle_cpu_pct on the real app (14-quality.md#performance-budgets), in one fresh
// app process with the 200-slide fixture lecture:
// - idle_rss_mb: 60 s after the lecture opened, the memory of the app and its webview processes,
//   every one by its share (D-161; procs.ts).
// - idle_cpu_pct: then 5 minutes of idle, the CPU those processes used, as a percent of one core.
//   Measured as F-180's idle flow measures it (tests/e2e/flows/idle-cpu/: the same release build,
//   60 s settle, 5-minute window, a per-process and per-thread sample every 15 s, the page's frame,
//   mutation and animation counters), with its code, so the two gates can't drift apart. The
//   measured state is the one a user leaves and F-180 gates: the editor focused, and parked.
// The detail lines break memory down per process and CPU per process and thread (D-149).
// The waits send no WebDriver commands, so the embedded WebDriver server is idle too.

import { installCounters, pageLines, readCounters } from "../../e2e/flows/idle-cpu/counters.ts";
import { sample } from "../../e2e/flows/idle-cpu/sample.ts";
import { cpuLines, cpuPct, series } from "../../e2e/flows/idle-cpu/threads.ts";
import { memoryMb, requireWebview, snapshot } from "./procs.ts";
import { idle, lecture, openLecture, record, wanted } from "./support.ts";

const RSS_AFTER_MS = 60_000;
const CPU_WINDOW_MS = 300_000;
const STEP_MS = 15_000;

describe("open and idle", function () {
  this.timeout(RSS_AFTER_MS + CPU_WINDOW_MS + 180_000);

  it("measures idle memory and CPU after opening the lecture", async () => {
    await openLecture(lecture().name);
    await installCounters();

    await idle(RSS_AFTER_MS);
    const now = snapshot();
    requireWebview(now);
    const mem = memoryMb(now);
    if (wanted("idle_rss_mb"))
      record("idle_rss_mb", mem.total, `${now.procs.length} processes 60 s after open: ${mem.parts}`);
    if (!wanted("idle_cpu_pct")) return;

    const app = process.env.LECTER_PERF_APP;
    if (!app) throw new Error("LECTER_PERF_APP is not set: run through tests/perf/app/run.sh");
    const from = Date.now();
    const samples = await sample(app, CPU_WINDOW_MS, STEP_MS);
    const to = Date.now();
    const page = await readCounters(from, to, STEP_MS);
    requireWebview(snapshot());
    const s = series(samples);
    // The whole 5-minute window was sampled, every 15 s, in the state F-180 gates: the editor
    // focused and parked. (The first and last snapshots' own clocks can be a few ms short of the
    // window: each is read after its reader process started, CI run 41742947222 on macOS.)
    expect(to - from).toBeGreaterThanOrEqual(CPU_WINDOW_MS);
    expect(samples).toHaveLength(CPU_WINDOW_MS / STEP_MS + 1);
    expect(page.focus.editorFocused).toBe(true);
    expect(page.focus.editable).toBe("false");
    const lines = [...cpuLines(s, STEP_MS / 1000), ...pageLines(page)].map((l) => l.replace(/^idle-attribution /, ""));
    record("idle_cpu_pct", cpuPct(s), lines.join(" | "));
  });
});
