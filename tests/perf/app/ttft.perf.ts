// ttft_overhead_ms on the real app (14-quality.md#performance-budgets): what Lecter adds to a
// provider's time to first token. The app's provider is the offline sample (D-131), which waits
// SAMPLE_FIRST_TOKEN before its first word, so the overhead is Enter in the prompt → the first
// answer text painted, minus that delay (read from crates/ai, so the two can't drift apart). Five
// asks on the first block, each stopped with Esc once its first words show; the median counts.
// Each ask is broken down (D-161: check the one-frame quantisation): the card batches stream text
// to one write per animation frame (ui/src/features/gloss/frame.ts), so the page wraps
// requestAnimationFrame for the ask and notes when the frame that wrote the first words was
// requested (the text reached the page), when that frame's write was done, and when it was
// painted. "to page" is the core and IPC part, "frame" the wait for the next frame (up to one
// refresh interval) and "paint" the rendering; the gated value is still their sum, as a user
// sees it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lecture, openLecture, percentile, pressKeys, record } from "./support.ts";

const ASKS = 5;
const QUESTION = "Why does linearity hold here?";

/** The sample provider's first-token delay in ms, from its source. */
function providerDelayMs(): number {
  const src = readFileSync(join(import.meta.dirname, "../../../crates/ai/src/provider/scripted.rs"), "utf8");
  const m = /pub const SAMPLE_FIRST_TOKEN: Duration = Duration::from_millis\((\d+)\);/.exec(src);
  if (!m?.[1]) throw new Error("SAMPLE_FIRST_TOKEN not found in crates/ai/src/provider/scripted.rs");
  return Number(m[1]);
}

/** One ask: the total and its parts (null when the batcher's frame wasn't seen). */
interface Part {
  total: number;
  toPage: number | null;
  frame: number | null;
  paint: number | null;
}

/** Each ask as "to page (minus the provider's delay) + frame wait + paint", in ms. */
function breakdown(parts: Part[], delay: number): string {
  const ms = (x: number | null, minus = 0) => (x === null ? "?" : (x - minus).toFixed(1));
  const each = parts.map((p) => `${ms(p.toPage, delay)} + ${ms(p.frame)} + ${ms(p.paint)}`);
  return `per ask, to page (core and IPC, minus the delay) + frame wait + paint: ${each.join(", ")}`;
}

describe("time to first token", function () {
  this.timeout(300_000);

  it("measures the overhead over the provider's first-token delay", async () => {
    const delay = providerDelayMs();
    const { name } = lecture();
    await openLecture(name);
    // The webview's frame interval (the median of 30 frames): the most a write can wait for its frame.
    const frameMs = await browser.execute(async () => {
      const at: number[] = [];
      for (let i = 0; i <= 30; i++) at.push(await new Promise<number>((r) => requestAnimationFrame(r)));
      const gaps = at.slice(1).map((t, i) => t - (at[i] as number));
      return gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? Number.NaN;
    });
    const totals: number[] = [];
    const parts: Part[] = [];
    for (let i = 0; i < ASKS; i++) {
      await pressKeys(["a"]);
      const total = await browser.execute(async (q: string) => {
        function until<T>(get: () => T | null | undefined, what: string, ms = 20_000): Promise<T> {
          return new Promise((resolve, reject) => {
            const now = get();
            if (now) return resolve(now);
            const timer = setTimeout(() => {
              obs.disconnect();
              reject(new Error(`timed out waiting for ${what}`));
            }, ms);
            const obs = new MutationObserver(() => {
              const v = get();
              if (!v) return;
              obs.disconnect();
              clearTimeout(timer);
              resolve(v);
            });
            obs.observe(document.documentElement, {
              childList: true,
              subtree: true,
              attributes: true,
              characterData: true,
            });
          });
        }
        const input = await until(
          () => document.querySelector<HTMLTextAreaElement>(".gloss-prompt-input"),
          "the prompt",
        );
        input.value = q;
        // The frame that writes the first words: when it was requested and when its write was done.
        const raf = window.requestAnimationFrame;
        const words = () =>
          (document.querySelector('.gloss[data-state="streaming"] .gloss-body')?.textContent ?? "").trim();
        let first: { requested: number; wrote: number } | null = null;
        window.requestAnimationFrame = (cb: FrameRequestCallback) => {
          const requested = performance.now();
          return raf.call(window, (frame: number) => {
            const before = words();
            cb(frame);
            if (first === null && before === "" && words() !== "") first = { requested, wrote: performance.now() };
          });
        };
        const t0 = performance.now();
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }),
        );
        await until(
          () =>
            (document.querySelector('.gloss[data-state="streaming"] .gloss-body')?.textContent ?? "").trim() || null,
          "the first words",
        );
        // The card writes stream text in an animation frame (one paint per frame), so the mutation
        // observer above ran inside that frame: a task posted now runs after its paint.
        const painted = await new Promise<number>((r) => {
          const ch = new MessageChannel();
          ch.port1.onmessage = () => {
            ch.port1.close();
            r(performance.now());
          };
          ch.port2.postMessage(0);
        });
        window.requestAnimationFrame = raf;
        const at = first as { requested: number; wrote: number } | null;
        // Stop the stream (D-133: Esc keeps what arrived) and wait for the card to go.
        document
          .querySelector(".cm-content")
          ?.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }),
          );
        // The live card (prompt, streaming or stopped) goes once the core's `stopped` saved the answer.
        await until(
          () =>
            document.querySelector('.gloss:is([data-state="prompt"], [data-state="streaming"], [data-state="stopped"])')
              ? null
              : true,
          "the stopped card to close",
        );
        return {
          total: painted - t0,
          toPage: at ? at.requested - t0 : null,
          frame: at ? at.wrote - at.requested : null,
          paint: at ? painted - at.wrote : null,
        };
      }, QUESTION);
      totals.push(total.total);
      parts.push(total);
    }
    // No first word can show before the provider sent it.
    expect(totals).toHaveLength(ASKS);
    expect(Math.min(...totals)).toBeGreaterThanOrEqual(delay);
    // Each ask's breakdown was found: the first words came in a frame of the card's batcher.
    expect(parts.filter((p) => p.toPage === null)).toEqual([]);
    const overheads = totals.map((t) => t - delay);
    record(
      "ttft_overhead_ms",
      percentile(overheads, 50),
      `median of ${ASKS} asks: Enter → first words painted ${totals.map((t) => t.toFixed(1)).join(", ")} ms, ` +
        `minus the sample provider's ${delay} ms first-token delay; ${breakdown(parts, delay)}; frame interval ${frameMs.toFixed(1)} ms; ${name}`,
    );
  });
});
