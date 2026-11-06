// rss_300_slides_mb on the real app (14-quality.md#performance-budgets): the 300-slide fixture
// lecture open and scrolled end to end, then the memory of the app and its webview processes,
// every one by its share (D-161; procs.ts). Read right after the scroll and again after each
// 5 s settle. On macOS WebContent's phys_footprint right after the scroll holds a transient (531 MB
// at the scroll, the total 398 MB 5 s later in CI run 41708685261, D-161), and when WebKit lets go
// of it varies (230-438 MB on the same code, D-225): the median of 3 settles counts. Elsewhere one
// settle, and the larger of the two samples counts (settle.ts). The detail lists every sample.

import { memoryMb, requireWebview, type Snapshot, snapshot } from "./procs.ts";
import { counted, SETTLE_MS, settles } from "./settle.ts";
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

    const sample = () => {
      const s: Snapshot = snapshot();
      requireWebview(s);
      return { snap: s, memory: memoryMb(s) };
    };
    const os = process.platform;
    const samples = [sample()];
    for (let n = 0; n < settles(os); n++) {
      await idle(SETTLE_MS);
      samples.push(sample());
    }
    const [atScroll, ...afterSettles] = samples.map((s) => s.memory.total);
    const c = counted(os, atScroll as number, afterSettles);
    const picked = samples[c.from] as (typeof samples)[number];
    record(
      "rss_300_slides_mb",
      c.value,
      `${slides}-slide fixture scrolled end to end in ${scrolled.steps} pages (${scrolled.height} px); ${c.detail}; ` +
        `${picked.snap.procs.length} processes: ${picked.memory.parts}`,
    );
  });
});
