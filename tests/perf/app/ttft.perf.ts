// ttft_overhead_ms on the real app (14-quality.md#performance-budgets): what Lecter adds to a
// provider's time to first token. The app's provider is the offline sample (D-131), which waits
// SAMPLE_FIRST_TOKEN before its first word, so the overhead is Enter in the prompt → the first
// answer text painted, minus that delay (read from crates/ai, so the two can't drift apart). Five
// asks on the first block, each stopped with Esc once its first words show; the median counts.

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

describe("time to first token", function () {
  this.timeout(300_000);

  it("measures the overhead over the provider's first-token delay", async () => {
    const delay = providerDelayMs();
    const { name } = lecture();
    await openLecture(name);
    const totals: number[] = [];
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
        return painted - t0;
      }, QUESTION);
      totals.push(total);
    }
    const overheads = totals.map((t) => t - delay);
    record(
      "ttft_overhead_ms",
      percentile(overheads, 50),
      `median of ${ASKS} asks: Enter → first words painted ${totals.map((t) => t.toFixed(1)).join(", ")} ms, ` +
        `minus the sample provider's ${delay} ms first-token delay; ${name}`,
    );
  });
});