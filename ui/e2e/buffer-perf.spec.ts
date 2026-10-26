import { Text } from "@codemirror/state";
import { chromium, expect, test } from "@playwright/test";
import { frontMatterEnd, isElement, lineKind } from "../src/features/buffer/syntax";
import { defaultFixture, type MockFixture } from "./mock-core";
import { installMockCore } from "./mock-core/install";
import { fixtureLecture } from "./mock-core/lectures";
import { installProbe, type Probe } from "./perf/probe";

// F-020 criterion 3: on the 200-slide fixture lecture, keystroke-to-paint p99 stays under the
// keystroke_p99_ms budget (8 ms, 14-quality.md#performance-budgets) against the mocked core.
// The method is the F-001 spike's (spikes/editor/README.md, D-080): Chromium with vsync off, so a
// frame is produced as soon as it is needed and the probe's time is end to end; the cursor on the
// middle slide, Vim `o`, then 50 warm-up and 500 measured keys of text with inline math and, every
// 60 characters, `Esc k j w b A`. Each key waits for the previous one's paint. The browser is
// launched here with those flags, whichever project runs the file; WebKitGTK is measured in the
// real app (Q-010).

const BUDGET_MS = 8;
const SLIDES = 200;
const WARMUP = 50;
const KEYS = 500;
const lecturePath = "lectures/2026-10-23-l07-fixture.md";
const text = fixtureLecture(SLIDES);

const fixture: MockFixture = {
  ...defaultFixture,
  courseOpen: {
    path: "/courses/STAT311",
    name: "STAT311",
    lectures: [{ name: "2026-10-23-l07-fixture.md", path: lecturePath }],
    slides: [],
    trust: "trusted",
  },
  lectures: { [lecturePath]: { path: lecturePath, name: "2026-10-23-l07-fixture.md", text } },
};

/** The element number (for `{count}G`) of slide `n`'s first block. */
function firstBlockOf(n: number): number {
  const doc = Text.of(text.split("\n"));
  const fm = frontMatterEnd(doc);
  let count = 0;
  for (let line = 1; line <= doc.lines; line++) {
    if (!isElement(lineKind(doc, line, fm))) continue;
    count++;
    if (doc.line(line).text.includes(`{#s${n}b1`)) return count;
  }
  throw new Error(`slide ${n} has no first block`);
}

function keySequence(n: number): string[] {
  const typed = "Variance of a sum adds $2\\operatorname{Cov}(X,Y)$ cross terms; check with dice. ";
  const keys: string[] = [];
  for (let i = 0; keys.length < n; i++) {
    if (i > 0 && i % 60 === 0) keys.push("Escape", "k", "j", "w", "b", "A");
    keys.push(typed[i % typed.length] as string);
  }
  return keys.slice(0, n);
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN;
}

test("the 200-slide lecture keeps keystroke-to-paint p99 under 8 ms", async ({ baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const browser = await chromium.launch({ args: ["--disable-gpu-vsync", "--disable-frame-rate-limit"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.addInitScript(installMockCore, fixture);
    await page.addInitScript(installProbe);
    await page.goto(`${baseURL}/`);
    await page.getByRole("button", { name: /open course folder/i }).click();
    await page.getByRole("button", { name: "2026-10-23-l07-fixture.md" }).click();
    await expect(page.locator(".slide-heading-label").first()).toHaveText(`Slide 1 / ${SLIDES}`);

    // `{count}G` to the middle slide's first block, then `o`: a new line below, in insert mode.
    for (const k of `${firstBlockOf(SLIDES / 2)}G`) await page.keyboard.press(k);
    await expect(page.locator(".slide-heading-label", { hasText: `Slide ${SLIDES / 2} / ${SLIDES}` })).toBeVisible();
    await page.keyboard.press("o");
    await expect(page.locator(".lecture-buffer")).toHaveAttribute("data-vim-mode", "insert");

    await page.evaluate(() => (window as unknown as { __probe: Probe }).__probe.flush());
    await page.evaluate(() => (window as unknown as { __probe: Probe }).__probe.reset());
    const keys = keySequence(WARMUP + KEYS);
    for (const k of keys) {
      await page.keyboard.press(k);
      await page.evaluate(() => (window as unknown as { __probe: Probe }).__probe.flush());
    }
    const samples = await page.evaluate(() => (window as unknown as { __probe: Probe }).__probe.samples());
    expect(samples).toHaveLength(keys.length);
    await expect(page.locator(".cm-content")).toContainText("cross terms; check");

    const measured = samples.slice(WARMUP).sort((a, b) => a - b);
    const p99 = percentile(measured, 99);
    const line =
      `${p99 < BUDGET_MS ? "PASS" : "FAIL"} keystroke_p99_ms ${p99.toFixed(2)} / ${BUDGET_MS} ` +
      `(p50 ${percentile(measured, 50).toFixed(2)}, p95 ${percentile(measured, 95).toFixed(2)}, ` +
      `max ${(measured.at(-1) ?? Number.NaN).toFixed(2)}; n=${measured.length} after ${WARMUP} warm-up; ` +
      `Chromium ${browser.version()} headless, vsync off; ${SLIDES}-slide fixture, ${text.length} chars)`;
    console.log(line);
    await testInfo.attach("perf", { body: line, contentType: "text/plain" });
    expect(p99).toBeLessThan(BUDGET_MS);
  } finally {
    await browser.close();
  }
});
