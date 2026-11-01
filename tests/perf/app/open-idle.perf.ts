// cold_open_ms, idle_rss_mb and idle_cpu_pct on the real app (14-quality.md#performance-budgets),
// in one fresh app process with the 200-slide fixture lecture:
// - cold_open_ms: process start → the page's first paint (the shell), plus Open course folder →
//   the lecture's buffer painted, measured in the page with no gap for the user's two clicks.
// - idle_rss_mb: 60 s after the lecture opened, the RSS sum of the app and its webview processes.
// - idle_cpu_pct: then 5 minutes of idle, the CPU those processes used, as a percent of one core.
// The waits send no WebDriver commands, so the embedded WebDriver server is idle too.

import { appPid, clockTicks, cpuTicks, rssMb, startedAtMs, tree } from "./procs.ts";
import { home, idle, lecture, openLecture, record, wanted } from "./support.ts";

const RSS_AFTER_MS = 60_000;
const CPU_WINDOW_MS = 300_000;

describe("open and idle", function () {
  this.timeout(RSS_AFTER_MS + CPU_WINDOW_MS + 180_000);

  it("measures the cold open, then idle memory and CPU", async () => {
    const pid = appPid(home());
    const ticks = clockTicks();
    const started = startedAtMs(pid, ticks);
    const { name } = lecture();
    const opened = await openLecture(name);

    if (wanted("cold_open_ms")) {
      // The page reports its first paint (or at least its load event), after the process started.
      expect(opened.firstPaintKind).not.toBe("none");
      const shell = opened.timeOrigin + (opened.firstPaint ?? Number.NaN) - started;
      expect(shell).toBeGreaterThan(0);
      expect(shell).toBeLessThan(60_000);
      record(
        "cold_open_ms",
        shell + opened.openMs,
        `process start → shell ${opened.firstPaintKind} ${shell.toFixed(0)} ms (±${(1000 / ticks).toFixed(0)}) + ` +
          `open course → buffer painted ${opened.openMs.toFixed(0)} ms; ${name}`,
      );
    }
    if (!wanted("idle_rss_mb") && !wanted("idle_cpu_pct")) return;

    await idle(RSS_AFTER_MS);
    const procs = tree(pid);
    // The webview runs in processes of its own: a tree of one would miss most of the memory.
    expect(procs.length).toBeGreaterThan(1);
    const rss = rssMb(procs);
    if (wanted("idle_rss_mb"))
      record("idle_rss_mb", rss.total, `${procs.length} processes 60 s after open: ${rss.parts}`);
    if (!wanted("idle_cpu_pct")) return;

    const before = cpuTicks(tree(pid));
    const t0 = Date.now();
    await idle(CPU_WINDOW_MS);
    const after = cpuTicks(tree(pid));
    const seconds = (Date.now() - t0) / 1000;
    let used = 0;
    // A process that started inside the window counts from zero; one that ended is lost (its
    // ticks are gone with it), which the detail line shows as a count.
    for (const [p, t] of after) used += t - (before.get(p) ?? 0);
    const gone = [...before.keys()].filter((p) => !after.has(p)).length;
    const pct = (used / ticks / seconds) * 100;
    record(
      "idle_cpu_pct",
      pct,
      `${used} ticks over ${seconds.toFixed(0)} s idle in ${after.size} processes (${gone} ended)`,
    );
  });
});