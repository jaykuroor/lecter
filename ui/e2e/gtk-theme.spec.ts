import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import type { ThemeUpdate } from "../src/core/bindings";
import { defaultFixture, expect, type MockFixture, test, trustScreen } from "./mock-core";
import { installMockCore } from "./mock-core/install";
import { fixtureLecture } from "./mock-core/lectures";

// F-043: a GTK theme's tokens from the core land in the page as custom properties on the root,
// over the Lecter theme, and a `theme:changed` update switches them live without a reload; tokens
// a theme doesn't set keep the Lecter theme's values. The updates are what the core computes for
// the fixture themes (crates/core/src/theme/gtk/tokens_tests.rs). The real app's flow
// (tests/e2e/flows/gtk-theme.ts) drives the core with a fake portal.
//
// D-237 asks for the cost, measured: the @perf test applies a full 27-token update 20 times on the
// 200-slide lecture and reports the time from the event to the next paint, and Chromium's style
// recalc and layout per update. Its gate is one frame (16 ms) at the median, as for F-042's flip.

type Pair = { light: string; dark: string };
const tokens = JSON.parse(readFileSync(join(import.meta.dirname, "../../docs/design/tokens.json"), "utf8")) as Record<
  string,
  Record<string, Pair>
>;
const lecter = (name: string, scheme: "light" | "dark") =>
  (tokens.color?.[name] ?? tokens["gloss-kind"]?.[name])?.[scheme] ?? "";

/** Greyish (gtk-3.0 names), light. */
const greyish: ThemeUpdate = {
  theme: "Greyish",
  scheme: "light",
  tokens: [
    { name: "window-bg", value: "#f7f7f7" },
    { name: "window-fg", value: "#323232" },
    { name: "view-bg", value: "#ffffff" },
    { name: "view-fg", value: "#363636" },
    { name: "accent-bg", value: "#f0544c" },
    { name: "accent-fg", value: "#ffffff" },
    { name: "dim", value: "#8b8b8b" },
    { name: "faint", value: "#a8a8a8" },
    { name: "borders", value: "rgba(0, 0, 0, 0.15)" },
    { name: "line2", value: "#efefef" },
  ],
};

/** Nightish: a dark theme with only its window colours. */
const nightish: ThemeUpdate = {
  theme: "Nightish",
  scheme: "dark",
  tokens: [
    { name: "window-bg", value: "#1e1e1e" },
    { name: "window-fg", value: "#ffffff" },
    { name: "dim", value: "#9a9a9a" },
    { name: "faint", value: "#787878" },
    { name: "borders", value: "#404040" },
  ],
};

/** `#rrggbb` as getComputedStyle prints it. */
function rgb(hex: string): string {
  const n = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16);
  return `rgb(${n(1)}, ${n(3)}, ${n(5)})`;
}

/** Each token as the colour it paints, inside an rgb(1, 2, 3) parent (a missing token inherits it). */
function painted(page: Page, names: string[]): Promise<Record<string, string>> {
  return page.evaluate((list) => {
    const parent = document.body.appendChild(document.createElement("div"));
    parent.style.color = "rgb(1, 2, 3)";
    const probe = parent.appendChild(document.createElement("span"));
    const out: Record<string, string> = {};
    for (const n of list) {
      probe.style.color = `var(--${n})`;
      out[n] = getComputedStyle(probe).color;
    }
    parent.remove();
    return out;
  }, names);
}

const send = (page: Page, update: ThemeUpdate) =>
  page.evaluate(
    (u) => (window as unknown as { __mockThemeChanged: (x: ThemeUpdate) => void }).__mockThemeChanged(u),
    update,
  );

test.describe("a GTK theme", () => {
  test.use({ mockCore: { ...defaultFixture, theme: { update: greyish, installed: [] } } });

  test("paints over the Lecter theme and follows a change live", async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await expect(page.locator(".app-frame")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const names = ["window-bg", "view-fg", "accent-bg", "borders", "headerbar-bg", "sidebar-bg", "k-derive"];
    expect(await painted(page, names)).toEqual({
      "window-bg": rgb("#f7f7f7"),
      "view-fg": rgb("#363636"),
      "accent-bg": rgb("#f0544c"),
      borders: "rgba(0, 0, 0, 0.15)",
      // Greyish sets none of these: Lecter's light values, though the OS prefers dark.
      "headerbar-bg": rgb(lecter("headerbar-bg", "light")),
      "sidebar-bg": rgb(lecter("sidebar-bg", "light")),
      "k-derive": rgb(lecter("k-derive", "light")),
    });
    expect(await page.locator(".app-frame").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      rgb("#f7f7f7"),
    );
    await page.screenshot({ path: testInfo.outputPath("gtk-theme.png") });

    await page.evaluate(() => {
      (window as unknown as { __marker: number }).__marker = 1;
    });
    await send(page, nightish);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await painted(page, names)).toEqual({
      "window-bg": rgb("#1e1e1e"),
      "view-fg": rgb(lecter("view-fg", "dark")),
      "accent-bg": rgb(lecter("accent-bg", "dark")),
      borders: rgb("#404040"),
      "headerbar-bg": rgb(lecter("headerbar-bg", "dark")),
      "sidebar-bg": rgb(lecter("sidebar-bg", "dark")),
      "k-derive": rgb(lecter("k-derive", "dark")),
    });
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(1);
    await page.screenshot({ path: testInfo.outputPath("gtk-theme-live.png") });

    // Back to no GTK theme: every token is Lecter's again and the OS decides the scheme.
    await send(page, { theme: null, scheme: null, tokens: [] });
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
    expect(await painted(page, ["window-bg", "accent-bg"])).toEqual({
      "window-bg": rgb(lecter("window-bg", "dark")),
      "accent-bg": rgb(lecter("accent-bg", "dark")),
    });
  });
});

const SLIDES = 200;
const WARMUP = 4;
const UPDATES = 20;
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

/** A full update: every token the mapping sets (27), coloured by `seed`. */
function full(seed: number, scheme: "light" | "dark"): ThemeUpdate {
  const names = [
    "window-bg",
    "window-fg",
    "view-bg",
    "view-fg",
    "headerbar-bg",
    "headerbar-border",
    "sidebar-bg",
    "card-bg",
    "popover-bg",
    "accent-bg",
    "accent-fg",
    "accent",
    "dim",
    "faint",
    "osd-bg",
    "osd-fg",
    "borders",
    "line2",
    "k-derive",
    "k-ask",
    "k-doubt",
    "k-source",
    "k-prof",
    "k-write",
    "k-later",
    "k-mine",
    "k-flag",
  ];
  const hex = (i: number) => `#${((seed * 40503 + i * 9973) % 0xffffff).toString(16).padStart(6, "0")}`;
  return { theme: `T${seed}`, scheme, tokens: names.map((name, i) => ({ name, value: hex(i) })) };
}

function percentile(xs: number[], p: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN;
}

test(
  "a theme:changed update on the 200-slide lecture paints within a frame",
  { tag: "@perf" },
  async ({ baseURL }, testInfo) => {
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
      const applyMs: number[] = [];
      const recalc: number[] = [];
      const layout: number[] = [];
      for (let i = 0; i < WARMUP + UPDATES; i++) {
        const update = full(i + 1, i % 2 === 0 ? "dark" : "light");
        const before = await metrics();
        const [ms, apply] = await page.evaluate(
          (u) =>
            new Promise<[number, number]>((done) => {
              const t0 = performance.now();
              (window as unknown as { __mockThemeChanged: (x: unknown) => void }).__mockThemeChanged(u);
              const t1 = performance.now();
              requestAnimationFrame(() => requestAnimationFrame(() => done([performance.now() - t0, t1 - t0])));
            }),
          update,
        );
        const after = await metrics();
        expect(await painted(page, ["window-bg"])).toEqual({ "window-bg": rgb(update.tokens[0]?.value ?? "") });
        if (i < WARMUP) continue;
        toPaint.push(ms);
        applyMs.push(apply);
        recalc.push(after.recalc - before.recalc);
        layout.push(after.layout - before.layout);
      }
      const nodes = await page.evaluate(() => document.getElementsByTagName("*").length);
      const f = (xs: number[]) => `median ${percentile(xs, 50).toFixed(2)}, p95 ${percentile(xs, 95).toFixed(2)}`;
      const report = [
        `theme:changed (27 tokens) → next paint (ms): ${f(toPaint)}, max ${Math.max(...toPaint).toFixed(2)}; n=${UPDATES} after ${WARMUP} warm-up`,
        `  listener + property writes (ms): ${f(applyMs)}`,
        `  style recalc per update (ms): ${f(recalc)}`,
        `  layout per update (ms): ${f(layout)}`,
        `  Chromium ${browser.version()} headless, vsync off; ${SLIDES}-slide fixture lecture open; ${nodes} elements`,
      ].join("\n");
      console.log(report);
      await testInfo.attach("gtk-theme-update", { body: report, contentType: "text/plain" });
      expect(percentile(toPaint, 50), report).toBeLessThan(FRAME_MS);
    } finally {
      await browser.close();
    }
  },
);
