// rss_300_slides_mb on the real app (14-quality.md#performance-budgets): the 300-slide fixture
// lecture open and scrolled end to end, then the memory of the app and its webview processes
// (D-146: the app's RSS plus the webview's share; procs.ts). Read right after the scroll and
// again 5 s later; the larger value counts.

import { memoryMb, requireWebview, snapshot } from "./procs.ts";
import { idle, lecture, openLecture, record } from "./support.ts";

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
    await idle(5_000);
    const now = snapshot();
    requireWebview(now);
    const second = memoryMb(now);
    const top = first.total >= second.total ? first : second;
    record(
      "rss_300_slides_mb",
      top.total,
      `${slides}-slide fixture scrolled end to end in ${scrolled.steps} pages (${scrolled.height} px); ` +
        `${first.total.toFixed(1)} then ${second.total.toFixed(1)} MB 5 s later; ${now.procs.length} processes: ${top.parts}`,
    );
  });
});