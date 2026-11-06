import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { defaultFixture, expect, type MockFixture, test, trustScreen } from "./mock-core";
import { installMockCore } from "./mock-core/install";
import { fixtureLecture } from "./mock-core/lectures";

// F-042: the bundled Lecter theme in the page. Criterion 3 (follow the OS dark/light preference):
// the page's prefers-color-scheme switches every token live, with no reload, and `data-theme` on
// <html> pins either scheme by one attribute (D-237). Expected colours come from
// docs/design/tokens.json. The real app's flow (tests/e2e/flows/theme.ts) changes the OS setting
// itself.
//
// D-237 also asks for the cost of a switch, measured: the @perf test flips data-theme 20 times on
// the 200-slide lecture and reports the time to the next paint (a double rAF, Chromium with vsync
// off as in buffer-perf.spec.ts) and the style-recalc and layout time Chromium spent on each flip.
// Its gate is one frame (16 ms) at the median.

type Pair = { light: string; dark: string };
const tokens = JSON.parse(readFileSync(join(import.meta.dirname, "../../docs/design/tokens.json"), "utf8")) as Record<
  string,
  Record<string, Pair>
>;
const colours = Object.entries({ ...tokens.color, ...tokens["gloss-kind"] }).filter(([name]) => !name.startsWith("$"));
const windowBg = tokens.color?.["window-bg"] as Pair;

/** `#rrggbb` as getComputedStyle prints it. */
function rgb(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`tokens.json colour "${hex}" is not #rrggbb`);
  const n = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16);
  return `rgb(${n(1)}, ${n(3)}, ${n(5)})`;
}

/**
 * Every colour token as the colour it paints (a probe's computed `color: var(--token)`), name →
 * `rgb(…)`. Resolved colours, not the properties' text, which the dev server serves as written and
 * a release build minifies (`#ffffff` → `#fff`).
 */
function tokenValues(page: Page): Promise<Record<string, string>> {
  return page.evaluate(
    (names) => {
      const probe = document.body.appendChild(document.createElement("span"));
      const out = Object.fromEntries(
        names.map((n) => {
          probe.style.color = `var(--${n})`;
          return [n, getComputedStyle(probe).color];
        }),
      );
      probe.remove();
      return out;
    },
    colours.map(([name]) => name),
  );
}

const want = (scheme: "light" | "dark") => Object.fromEntries(colours.map(([name, v]) => [name, rgb(v[scheme])]));
const frameBackground = (page: Page) =>
  page.locator(".app-frame").evaluate((el) => getComputedStyle(el).backgroundColor);

test("the page follows the OS colour scheme live, and data-theme pins one", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator(".app-frame")).toBeVisible();
  expect(await tokenValues(page)).toEqual(want("light"));
  expect(await frameBackground(page)).toBe(rgb(windowBg.light));

  // The OS switches to dark: every token follows, without a reload.
  await page.evaluate(() => {
    (window as unknown as { __marker: number }).__marker = 1;
  });
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await tokenValues(page)).toEqual(want("dark"));
  expect(await frameBackground(page)).toBe(rgb(windowBg.dark));
  expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(1);

  // data-theme="light" pins light under a dark OS, and data-theme="dark" pins dark under a light one.
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  expect(await tokenValues(page)).toEqual(want("light"));
  await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  expect(await tokenValues(page)).toEqual(want("dark"));
  expect(await frameBackground(page)).toBe(rgb(windowBg.dark));

  // Without the attribute the OS decides again.
  await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
  expect(await tokenValues(page)).toEqual(want("light"));
});

const SLIDES = 200;
const WARMUP = 4;
const FLIPS = 20;
const FRAME_MS = 16;
const lecturePath = "lectures/2026-10-23-l07-fixture.md";
const lectureFixture: MockFixture = {
  ...defaultFixture,
  courseOpen: {
    path: "/courses/STAT311",
    name: "STAT311",
    lectures: [{ name: "2026-10-23-l07-fixture.md", path: lecturePath }],
    slides: [],
    sources: [],
    trust: "trusted",
    screen: trustScreen,
  },
  lectures: { [lecturePath]: { path: lecturePath, name: "2026-10-23-l07-fixture.md", text: fixtureLecture(SLIDES) } },
};

function percentile(xs: number[], p: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN;
}

test.use({ trace: "off" });

test("a theme flip on the 200-slide lecture paints within a frame", { tag: "@perf" }, async ({ baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const browser = await chromium.launch({ args: ["--disable-gpu-vsync", "--disable-frame-rate-limit"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.addInitScript(installMockCore, lectureFixture);
    await page.goto(`${baseURL}/`);
    await page.getByRole("button", { name: "Add a course" }).click();
    await page.getByRole("button", { name: "2026-10-23-l07-fixture.md" }).click();
    await expect(page.locator(".slide-heading-label").first()).toHaveText(`Slide 1 / ${SLIDES}`);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const metrics = async () => {
      const { metrics: m } = await cdp.send("Performance.getMetrics");
      const get = (name: string) => (m.find((x) => x.name === name)?.value ?? 0) * 1000;
      return { recalc: get("RecalcStyleDuration"), layout: get("LayoutDuration") };
    };
    const toPaint: number[] = [];
    const recalc: number[] = [];
    const layout: number[] = [];
    for (let i = 0; i < WARMUP + FLIPS; i++) {
      const scheme = i % 2 === 0 ? "dark" : "light";
      const before = await metrics();
      const ms = await page.evaluate(
        (s) =>
          new Promise<number>((done) => {
            const t0 = performance.now();
            document.documentElement.setAttribute("data-theme", s);
            requestAnimationFrame(() => requestAnimationFrame(() => done(performance.now() - t0)));
          }),
        scheme,
      );
      const after = await metrics();
      expect(await frameBackground(page)).toBe(rgb(windowBg[scheme]));
      if (i < WARMUP) continue;
      toPaint.push(ms);
      recalc.push(after.recalc - before.recalc);
      layout.push(after.layout - before.layout);
    }
    const nodes = await page.evaluate(() => document.getElementsByTagName("*").length);
    const f = (xs: number[]) => `median ${percentile(xs, 50).toFixed(2)}, p95 ${percentile(xs, 95).toFixed(2)}`;
    const report = [
      `theme flip → next paint (ms): ${f(toPaint)}, max ${Math.max(...toPaint).toFixed(2)}; n=${FLIPS} after ${WARMUP} warm-up`,
      `  style recalc per flip (ms): ${f(recalc)}`,
      `  layout per flip (ms): ${f(layout)}`,
      `  Chromium ${browser.version()} headless, vsync off; ${SLIDES}-slide fixture lecture open; ${nodes} elements`,
    ].join("\n");
    console.log(report);
    await testInfo.attach("theme-flip", { body: report, contentType: "text/plain" });
    expect(percentile(toPaint, 50), report).toBeLessThan(FRAME_MS);
  } finally {
    await browser.close();
  }
});
