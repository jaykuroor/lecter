// keystroke_p99_ms on the real app (14-quality.md#performance-budgets): 50 warm-up and 500
// measured keystrokes in the 200-slide fixture lecture, the F-001 method (spikes/editor/README.md,
// D-080) and the same key sequence as the mocked-core check (ui/e2e/buffer-perf.spec.ts): the
// cursor on the middle slide's first block, Vim `o`, then text with inline math and, every 60
// characters, `Esc k j w b A`.
//
// WebKitGTK can't turn vsync off, so the budget number is the spike's "work" for WebKit: per key,
// the handler time (keydown dispatch, the text input, the editor's update) plus the frame time
// (the next frame's rAF → after its paint), leaving out the wait for the display's next frame.
// The raw keystroke-to-paint time, wait included, goes in the detail line.
//
// WebDriver keys are synthetic, so the page types itself: a keydown the editor doesn't handle is
// followed by `insertText`, the input a real key press makes. The typed text must end up in the
// buffer, or there is no measurement.

import { elementNumber, lecture, openLecture, percentile, pressKeys, record } from "./support.ts";

const WARMUP = 50;
const KEYS = 500;
const TYPED = "Variance of a sum adds $2\\operatorname{Cov}(X,Y)$ cross terms; check with dice. ";

function keySequence(n: number): string[] {
  const keys: string[] = [];
  for (let i = 0; keys.length < n; i++) {
    if (i > 0 && i % 60 === 0) keys.push("Escape", "k", "j", "w", "b", "A");
    keys.push(TYPED[i % TYPED.length] as string);
  }
  return keys.slice(0, n);
}

interface Sample {
  handler: number;
  frame: number;
  raw: number;
}

describe("keystroke to paint", function () {
  this.timeout(300_000);

  it("measures 500 keystrokes in the 200-slide lecture", async () => {
    const { name, text } = lecture();
    const slides = (text.match(/^::: \{\.slide /gm) ?? []).length;
    const middle = Math.floor(slides / 2);
    await openLecture(name);
    await pressKeys([...`${elementNumber(text, `s${middle}b1`)}`, "G"]);
    await pressKeys(["o"]);
    const mode = await browser.execute(() => document.querySelector(".lecture-buffer")?.getAttribute("data-vim-mode"));
    expect(mode).toBe("insert");

    const result = await browser.execute(
      async (keys: string[]) => {
        const content = document.querySelector<HTMLElement>(".cm-content");
        if (!content) throw new Error("no buffer");
        content.focus();
        const out: { handler: number; frame: number; raw: number }[] = [];
        for (const key of keys) {
          const t0 = performance.now();
          const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
          const unhandled = content.dispatchEvent(ev);
          if (unhandled && key.length === 1) document.execCommand("insertText", false, key);
          // The editor reads the DOM change in a mutation observer: let it run before the clock stops.
          await Promise.resolve();
          await Promise.resolve();
          const t1 = performance.now();
          const frameStart = await new Promise<number>((r) => requestAnimationFrame(() => r(performance.now())));
          const paintedAt = await new Promise<number>((r) => {
            const ch = new MessageChannel();
            ch.port1.onmessage = () => {
              ch.port1.close();
              r(performance.now());
            };
            ch.port2.postMessage(0);
          });
          out.push({ handler: t1 - t0, frame: paintedAt - frameStart, raw: paintedAt - t0 });
        }
        return { samples: out, text: content.textContent ?? "", ua: navigator.userAgent };
      },
      keySequence(WARMUP + KEYS),
    );

    // The typed text reached the buffer, so the keys were measured on real edits.
    expect(result.text).toContain("cross terms; check");
    const measured: Sample[] = result.samples.slice(WARMUP);
    expect(measured).toHaveLength(KEYS);
    const work = measured.map((s) => s.handler + s.frame);
    const p = (xs: number[], q: number) => percentile(xs, q).toFixed(2);
    const handler = measured.map((s) => s.handler);
    const frame = measured.map((s) => s.frame);
    const raw = measured.map((s) => s.raw);
    record(
      "keystroke_p99_ms",
      percentile(work, 99),
      `work p50/p95/p99 ${p(work, 50)}/${p(work, 95)}/${p(work, 99)} (handler p99 ${p(handler, 99)}, frame p99 ${p(frame, 99)}); ` +
        `raw with the frame wait p50/p99 ${p(raw, 50)}/${p(raw, 99)}; n=${KEYS} after ${WARMUP} warm-up; ${slides}-slide fixture; ${result.ua}`,
    );
  });
});