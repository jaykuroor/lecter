// One launch of cold_open_ms on the real app (14-quality.md#performance-budgets): process start →
// the page's first paint (the shell), plus Add a course → the lecture's buffer painted,
// measured in the page with no gap for the user's two clicks (the e2e-app cold-open flow's
// definition, F-179). run.sh launches this 5 times, each a fresh process started once the
// previous one's processes have all ended, and the harness gates their median (D-152).

import { appStartedMs, snapshot } from "./procs.ts";
import { lecture, openLecture, record } from "./support.ts";

describe("cold open", function () {
  this.timeout(180_000);

  it("measures process start to the lecture's first paint", async () => {
    const started = appStartedMs(snapshot());
    const { name } = lecture();
    const opened = await openLecture(name);
    // The page reports its first paint (or at least its load event), after the process started.
    expect(opened.firstPaintKind).not.toBe("none");
    const shell = opened.timeOrigin + (opened.firstPaint ?? Number.NaN) - started;
    expect(shell).toBeGreaterThan(0);
    expect(shell).toBeLessThan(60_000);
    record(
      "cold_open_ms",
      shell + opened.openMs,
      `process start → shell ${opened.firstPaintKind} ${shell.toFixed(0)} ms + ` +
        `open course → buffer painted ${opened.openMs.toFixed(0)} ms; ${name}; ${process.platform}`,
    );
    snapshot(); // notes the webview's processes too, so the next launch waits for all of them

  });
});
