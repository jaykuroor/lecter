import { appendFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { Text } from "@codemirror/state";
import { type Browser, chromium, expect, test } from "@playwright/test";
import { frontMatterEnd, isElement, lineKind } from "../src/features/buffer/syntax";
import { defaultFixture, type MockFixture } from "./mock-core";
import { installMockCore } from "./mock-core/install";
import { fixtureLecture } from "./mock-core/lectures";
import { exclusive } from "./perf/exclusive";
import { installProbe, type Probe } from "./perf/probe";
import { limitOf, passes, readBudget, remeasure } from "./perf/timing-budget";

// F-020 criterion 3: on the 200-slide fixture lecture, keystroke-to-paint p99 stays under the
// keystroke_p99_ms budget (8 ms, 14-quality.md#performance-budgets) against the mocked core.
// The method is the F-001 spike's (spikes/editor/README.md, D-080): Chromium with vsync off, so a
// frame is produced as soon as it is needed and the probe's time is end to end; the cursor on the
// middle slide, Vim `o`, then 50 warm-up and 500 measured keys of text with inline math and, every
// 60 characters, `Esc k j w b A`. Each key waits for the previous one's paint. The browser is
// launched here with those flags, whichever project runs the file; WebKitGTK is measured in the
// real app (Q-010).
//
// The gate follows 14-quality's timing rule (perf/timing-budget.ts): ×1 locally, ×1.5 under CI
// with one re-measure, both values in the report. Two things that are not the editor are kept out
// of the measurement (CI-a0174c9): the Playwright trace recorder, which snapshots the page on each
// of the ~1,100 actions, and the other project's copy of this check running at the same time
// (perf/exclusive.ts).

/** The spec value of keystroke_p99_ms, used until tests/perf/budgets.json has the entry (F-025). */
const SPEC_BUDGET_MS = 8;
const budgetsFile = join(import.meta.dirname, "../../tests/perf/budgets.json");
const budget = readBudget(budgetsFile, "keystroke_p99_ms", SPEC_BUDGET_MS);
const ci = Boolean(process.env.CI);
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

const pct = (xs: number[], p: number) =>
  percentile(
    [...xs].sort((a, b) => a - b),
    p,
  ).toFixed(2);

interface Run {
  p99: number;
  line: string;
}

/** One measurement on a new page of `browser`: the method above, ending in its report line. */
async function measure(browser: Browser, baseURL: string | undefined): Promise<Run> {
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
  const phases = await page.evaluate(() => (window as unknown as { __probe: Probe }).__probe.phases());
  expect(samples).toHaveLength(keys.length);
  await expect(page.locator(".cm-content")).toContainText("cross terms; check");
  // After the measurement, so it can't slow it: what the headless browser renders with.
  const gl = await page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("webgl");
    const info = ctx?.getExtension("WEBGL_debug_renderer_info");
    const renderer = ctx && info ? String(ctx.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "no WebGL";
    return `${renderer}; ${navigator.hardwareConcurrency} threads`;
  });
  await page.close();

  const measured = samples.slice(WARMUP).sort((a, b) => a - b);
  const toFrame = phases.slice(WARMUP).map((x) => x.toFrame);
  const painted = phases.slice(WARMUP).map((x) => x.painted);
  const p99 = percentile(measured, 99);
  const host = cpus();
  const line =
    `p99 ${p99.toFixed(2)} (p50 ${percentile(measured, 50).toFixed(2)}, p95 ${percentile(measured, 95).toFixed(2)}, ` +
    `max ${(measured.at(-1) ?? Number.NaN).toFixed(2)}; input→frame p50/p99 ${pct(toFrame, 50)}/${pct(toFrame, 99)}, ` +
    `frame→painted ${pct(painted, 50)}/${pct(painted, 99)}; n=${measured.length} after ${WARMUP} warm-up; ` +
    `Chromium ${browser.version()} headless, vsync off; ${SLIDES}-slide fixture, ${text.length} chars; ` +
    `GL ${gl}; host ${host.length}× ${host[0]?.model ?? "?"}, load ${(loadavg()[0] ?? 0).toFixed(2)})`;
  return { p99, line };
}

// The trace recorder snapshots the page on every action, which is not the editor's time.
test.use({ trace: "off" });

test("the 200-slide lecture keeps keystroke-to-paint p99 under 8 ms", async ({ baseURL }, testInfo) => {
  test.setTimeout(240_000);
  const lock = join(testInfo.project.outputDir, ".keystroke-perf.lock");
  const runs = await exclusive(lock, 150_000, async () => {
    const done: Run[] = [];
    do {
      const browser = await chromium.launch({ args: ["--disable-gpu-vsync", "--disable-frame-rate-limit"] });
      try {
        done.push(await measure(browser, baseURL));
      } finally {
        await browser.close();
      }
    } while (
      remeasure(
        done.map((r) => r.p99),
        budget,
        ci,
      )
    );
    return done;
  });
  const values = runs.map((r) => r.p99);
  const ok = passes(values, budget, ci);
  const allowance = ci && budget.timing ? " ×1.5 CI allowance" : "";
  const report = [
    `${ok ? "PASS" : "FAIL"} keystroke_p99_ms ${values.map((v) => v.toFixed(2)).join(", ")} / ` +
      `${limitOf(budget, ci).toFixed(2)} (budget ${budget.value} from ${budget.source}${allowance})`,
    ...runs.map((r, i) => `  run ${i + 1}: ${r.line}`),
  ].join("\n");
  console.log(report);
  // verify.sh prints only failures, so a passing CI run shows the values on its summary page; the
  // gardener tracks values between ×1 and ×1.5 (14-quality.md#performance-budgets).
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `\`[${testInfo.project.name}]\`\n\n\`\`\`\n${report}\n\`\`\`\n\n`);
  await testInfo.attach("perf", { body: report, contentType: "text/plain" });
  expect(ok, report).toBe(true);
});
