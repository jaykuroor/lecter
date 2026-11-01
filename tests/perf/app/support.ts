// Shared by the real-app measurements (tests/perf/app/*.perf.ts): the run's settings from
// tests/perf/app/run.sh, the result lines for tests/perf/harness.py, and the in-page steps.
//
// Everything that is timed runs inside the page in one `browser.execute`, never as a series of
// WebDriver commands: each command costs a round trip, and @wdio/tauri-service adds a window-focus
// check of up to ~10 s before element commands. So these steps use no `$()`; they click and type
// through the DOM, as the real-app flows do for keys (tests/CLAUDE.md: WebDriver keys are
// synthetic events). Functions passed to `browser.execute` are serialised: they must be
// self-contained.

import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

function env(name: string): string {
  const v = process.env[name];
  if (!v)
    throw new Error(`${name} is not set: run the measurements through tests/perf/budgets.sh (tests/perf/app/run.sh)`);
  return v;
}

/** The ids this run should measure. */
export const wanted = (id: string): boolean => env("LECTER_PERF_IDS").split(" ").includes(id);

/** The test home the app runs with (its process is found by it). */
export const home = (): string => env("LECTER_TEST_HOME");

/** The fixture lecture's file name and text in this run's course. */
export function lecture(): { name: string; text: string } {
  const name = env("LECTER_PERF_LECTURE");
  return { name, text: readFileSync(join(env("LECTER_TEST_PICK"), "lectures", name), "utf8") };
}

/** One result line for the harness (tests/perf/harness.py reads the run's results file). */
export function record(id: string, value: number, detail: string): void {
  appendFileSync(env("LECTER_PERF_OUT"), `${JSON.stringify({ id, value: Number(value.toFixed(2)), detail })}\n`);
  console.log(`measured ${id} ${value.toFixed(2)} (${detail})`);
}

/** The pth percentile (nearest rank) of `xs`. */
export function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] ?? Number.NaN;
}

/** Waits `ms` of wall time with no WebDriver traffic: an idle window being measured, not a sync. */
export function idle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface Opened {
  /** Click on Open course folder → the lecture's buffer painted, ms. */
  openMs: number;
  /** The page's time origin (epoch ms) and its first contentful paint (ms after it), if reported. */
  timeOrigin: number;
  firstPaint: number | null;
  /** What `firstPaint` is: the paint entry, or the load event when the engine has no paint timing. */
  firstPaintKind: string;
}

/**
 * In the page: clicks Open course folder (LECTER_TEST_PICK answers the dialog), then the lecture
 * `name`, and waits for its buffer's first paint. Also returns the page's own first paint.
 */
export async function openLecture(name: string): Promise<Opened> {
  return await browser.execute(async (file: string) => {
    function until<T>(get: () => T | null | undefined, what: string, ms = 60_000): Promise<T> {
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
    function painted(): Promise<void> {
      return new Promise((resolve) =>
        requestAnimationFrame(() => {
          const ch = new MessageChannel();
          ch.port1.onmessage = () => {
            ch.port1.close();
            resolve();
          };
          ch.port2.postMessage(0);
        }),
      );
    }
    const open = await until(
      () => document.querySelector<HTMLButtonElement>("button.course-open"),
      "Open course folder",
    );
    const t0 = performance.now();
    open.click();
    const button = await until(
      () =>
        Array.from(document.querySelectorAll<HTMLButtonElement>("button.course-file-open")).find(
          (b) => b.textContent?.trim() === file,
        ),
      `${file} in the course`,
    );
    button.click();
    await until(
      () => document.querySelector(`.lecture-buffer[data-lecture="lectures/${file}"] .cm-line`),
      "the lecture buffer",
    );
    await painted();
    const openMs = performance.now() - t0;
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return {
      openMs,
      timeOrigin: performance.timeOrigin,
      firstPaint: fcp ? fcp.startTime : nav ? nav.loadEventEnd : null,
      firstPaintKind: fcp ? "first-contentful-paint" : nav ? "load event (no paint timing)" : "none",
    };
  }, name);
}

/** In the page: dispatches `keys` as keydown events to the focused buffer, then waits for a paint. */
export async function pressKeys(keys: string[]): Promise<void> {
  await browser.execute(async (list: string[]) => {
    const content = document.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("no buffer");
    content.focus();
    for (const key of list) {
      const target = document.activeElement ?? content;
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    }
    await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  }, keys);
}

/**
 * The element number (for Vim's `{count}G`) of the block `{#id`: lecture lines that are blocks or
 * other non-blank text, outside the front matter and not a slide fence, fence or slide title
 * (ui/src/features/buffer/syntax.ts, isElement).
 */
export function elementNumber(text: string, id: string): number {
  const lines = text.split("\n");
  let start = 0;
  if (lines[0] === "---") start = lines.findIndex((l, i) => i > 0 && (l === "---" || l === "...")) + 1;
  let n = 0;
  for (let i = start; i < lines.length; i++) {
    const t = lines[i] as string;
    if (t.trim() === "" || t.startsWith(":::")) continue;
    if (t.startsWith("## ") && (lines[i - 1] ?? "").startsWith("::: {.slide")) continue;
    n++;
    if (t.includes(`{#${id}`)) return n;
  }
  throw new Error(`no block ${id} in the lecture`);
}