// rss_300_slides_mb on the real app (14-quality.md#performance-budgets): the 300-slide fixture
// lecture open and scrolled end to end, then the memory of the app and its webview processes,
// every one by its share (D-161; procs.ts). Read right after the scroll and again after the
// settle, 5 s later. On macOS the sample after the settle counts (D-161): WebContent's
// phys_footprint right after the scroll holds a transient (531 MB at the scroll, the total 398 MB
// 5 s later in CI run 41708685261). Elsewhere the larger of the two counts.

import { memoryMb, requireWebview, snapshot } from "./procs.ts";
import { idle, lecture, openLecture, record } from "./support.ts";

/** The settle between the two samples. */
const SETTLE_MS = 5_000;

/** The OSes whose sample after the settle counts, not the larger of the two (D-161). */
const afterSettle = (os: string) => os === "darwin";

describe("memory with 300 slides", function () {
  this.timeout(300_000);

  it("measures memory after scrolling the 300-slide lecture end to end", async () => {
    const { name, text } = lecture();
    const slides = (text.match(/^::: \{\.slide /gm) ?? []).length;
    await openLecture(name);

    const scrolled = await browser.execute(async (total: number) => {
      const start = document.querySelector<HTMLElement>(".cm-scroller");
      if (!start) throw new Error("no buffer scroller");
      // The element that scrolls: the editor's scroller or the first scrollable ancestor.
      let box: HTMLElement | null = start;
      while (
        box &&
        !(box.scrollHeight > box.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(box).overflowY))
      ) {
        box = box.parentElement;
      }
      if (!box) throw new Error("nothing scrolls");
      const frame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      let steps = 0;
      const deadline = performance.now() + 120_000;
      // Page by page: the editor renders and measures what comes into view as it goes.
      while (box.scrollTop + box.clientHeight < box.scrollHeight - 1 && performance.now() < deadline) {
        box.scrollTop += box.clientHeight;
        steps++;
        await frame();
      }
      await frame();
      const labels = Array.from(document.querySelectorAll(".slide-heading-label"), (l) => l.textContent ?? "");
      return { steps, height: box.scrollHeight, atEnd: labels.some((l) => l.endsWith(`Slide ${total} / ${total}`)) };
    }, slides);
    // Scrolled to the end: the last slide's heading rendered.
    expect(scrolled.atEnd).toBe(true);
    expect(scrolled.steps).toBeGreaterThan(1);

    const then = snapshot();
    requireWebview(then);
    const first = memoryMb(then);
    await idle(SETTLE_MS);
    const now = snapshot();
    requireWebview(now);
    const second = memoryMb(now);
    const os = process.platform;
    const counts = afterSettle(os) || second.total >= first.total ? second : first;
    record(
      "rss_300_slides_mb",
      counts.total,
      `${slides}-slide fixture scrolled end to end in ${scrolled.steps} pages (${scrolled.height} px); ` +
        `${first.total.toFixed(1)} then ${second.total.toFixed(1)} MB ${SETTLE_MS / 1000} s later ` +
        `(${afterSettle(os) ? `${os}: the sample after the settle counts` : "the larger counts"}); ` +
        `${now.procs.length} processes: ${counts.parts}`,
    );
  });
});
