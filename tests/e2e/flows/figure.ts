// F-024: one described figure in the real app. Enter on a slide block, a question that asks for a
// plot, Enter: the offline sample provider answers with a function plot spec (08-figures.md#tiers),
// the gloss is saved with it, and the gloss shows the plot, computed in the app (criterion 1).
// From before the question until the end, every request the page makes is recorded (resource
// timing, plus fetch, XHR, WebSocket, EventSource and sendBeacon): none may leave the app's own
// origin and IPC (criterion 2). Scrolled out of view the plot's drawing goes; back in view it is
// drawn again (criterion 3).
//
// The embedded WebDriver sends keys as synthetic KeyboardEvents: the key engine reads Enter from
// them, but they can't type text, so the question goes into the prompt's textarea through the DOM
// (as in gloss.ts). CodeMirror re-renders widgets, so the figure is read in one browser.execute
// each time.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { shot } from "../support/shot.ts";

const NAME = "2026-10-26-l11-figure.md";
const STEM = "2026-10-26-l11-figure";
const QUESTION = "Can you plot this?";

// A synthetic lecture as Lecter writes it (03-lecture-files.md), long enough to scroll the first
// slide out of view. English only.
const FILLER = Array.from({ length: 12 }, (_, i) => {
  const n = i + 2;
  return [
    `::: {.slide #s${n} n=${n} title="Practice ${n}"}`,
    `## Practice ${n}`,
    "",
    `[Exercise ${n}: square the number ${n} and compare it with ${n} times ${n}.]{#s${n}b1}`,
    "",
    `[A square is never negative, so the parabola opens upward.]{#s${n}b2}`,
    "",
    `[Doubling x multiplies x squared by four.]{#s${n}b3}`,
    "",
    ":::",
    "",
  ];
}).flat();
const LECTURE = [
  "---",
  "lecter: 1",
  "lecture: 11",
  "date: 2026-10-26",
  "title: Parabolas",
  "---",
  "",
  '::: {.slide #s1 n=1 src="A1" title="The square function"}',
  "## The square function",
  "",
  "[The function x squared is a parabola with its lowest point at the origin.]{#s1b1}",
  "",
  ":::",
  "",
  ...FILLER,
].join("\n");

function course(): string {
  const dir = process.env.LECTER_TEST_PICK;
  if (!dir) throw new Error("LECTER_TEST_PICK is not set: run flows through scripts/e2e-app.sh");
  return dir;
}

const file = () => join(course(), "lectures", NAME);

/** Polls `done` with a deadline. */
async function until(done: () => Promise<boolean>, timeout: number, what: string): Promise<void> {
  await browser.waitUntil(done, { timeout, interval: 100, timeoutMsg: `timed out waiting for ${what}` });
}

/** The figure as the page shows it now (null when CodeMirror has no figure in the DOM). */
function figure(): Promise<{
  drawn: string;
  visible: string;
  svgs: number;
  label: string;
  legend: string;
  curve: string;
  points: number;
  inGloss: boolean;
} | null> {
  return browser.execute(() => {
    const f = document.querySelector<HTMLElement>("figure.figure");
    if (!f) return null;
    // The line above the figure is the spec's closing fence; above that, the spec in the gloss.
    const prev = f.previousElementSibling?.textContent ?? "";
    return {
      drawn: f.dataset.drawn ?? "",
      visible: f.dataset.visible ?? "",
      svgs: document.querySelectorAll("figure.figure svg").length,
      label: f.querySelector("svg")?.getAttribute("aria-label") ?? "",
      legend: f.querySelector(".figure-legend")?.textContent ?? "",
      curve: f.querySelector("path.figure-curve")?.getAttribute("d") ?? "",
      points: f.querySelectorAll("circle.figure-point").length,
      inGloss: prev === "```",
    };
  });
}

/** Starts recording every request the page makes from now on, by every way a page can make one. */
function recordRequests(): Promise<void> {
  return browser.execute(() => {
    const w = window as unknown as { __f024Requests?: string[] };
    const seen: string[] = [];
    w.__f024Requests = seen;
    const note = (url: unknown) => seen.push(String(url instanceof Request ? url.url : url));
    performance.setResourceTimingBufferSize(100_000);
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) note(e.name);
    }).observe({ type: "resource" });
    const fetch0 = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      note(input);
      return fetch0(input, init);
    };
    const open0 = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: []) {
      note(url);
      return (open0 as (m: string, u: string | URL, ...r: []) => void).call(this, method, url, ...rest);
    };
    const WS = window.WebSocket;
    window.WebSocket = class extends WS {
      constructor(url: string | URL, protocols?: string | string[]) {
        note(url);
        super(url, protocols);
      }
    };
    const ES = window.EventSource;
    window.EventSource = class extends ES {
      constructor(url: string | URL, init?: EventSourceInit) {
        note(url);
        super(url, init);
      }
    };
    const beacon0 = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
      note(url);
      return beacon0(url, data);
    };
  });
}

/** The recorded requests that left the app: not its own origin, not its IPC. */
function networkRequests(): Promise<{ all: string[]; network: string[] }> {
  return browser.execute(() => {
    const all = (window as unknown as { __f024Requests?: string[] }).__f024Requests ?? [];
    const own = (u: URL) =>
      u.origin === location.origin ||
      u.protocol === "ipc:" ||
      u.protocol === "tauri:" ||
      u.hostname === "ipc.localhost" ||
      u.hostname === "tauri.localhost";
    const network = all.filter((url) => {
      try {
        return !own(new URL(url, location.href));
      } catch {
        return true;
      }
    });
    return { all, network };
  });
}

/** Scrolls the lecture to its top (the figure in view) or its bottom (out of view). */
function scrollTo(where: "top" | "bottom"): Promise<boolean> {
  return browser.execute((w: string) => {
    // The nearest box above the text that scrolls (CodeMirror's scroller, or the column's).
    let scroller = document.querySelector<HTMLElement>(".cm-content")?.parentElement ?? null;
    while (scroller && scroller.scrollHeight <= scroller.clientHeight) scroller = scroller.parentElement;
    if (!scroller) return false;
    scroller.scrollTop = w === "top" ? 0 : scroller.scrollHeight;
    return true;
  }, where);
}

/** Types `question` into the open prompt and dispatches Enter to it. */
function send(question: string): Promise<boolean> {
  return browser.execute((q: string) => {
    const input = document.querySelector<HTMLTextAreaElement>(".gloss-prompt-input");
    if (!input) return false;
    input.value = q;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
    return true;
  }, question);
}

describe("a described figure", function () {
  // The service's window-focus check adds up to ~10 s of waits before every find and click, and
  // the sample answer streams for about 6 s.
  this.timeout(300_000);

  before(() => {
    mkdirSync(join(course(), "lectures"), { recursive: true });
    writeFileSync(file(), LECTURE);
  });

  // Other flows list this course's lectures exactly.
  after(() => {
    rmSync(file(), { force: true });
    const journal = join(course(), ".lecter", "journal");
    if (existsSync(journal)) {
      for (const f of readdirSync(journal).filter((f) => f.startsWith(STEM))) rmSync(join(journal, f), { force: true });
    }
  });

  it("draws the answer's fnplot spec as a plot inside the gloss, with no network request", async () => {
    await $("button.rail-add").click();
    await $(`button.course-file-open[data-path="lectures/${NAME}"]`).click();
    await expect($(".lecture-buffer")).toHaveAttribute("data-lecture", `lectures/${NAME}`);
    await expect($(".lecture-buffer")).toHaveAttribute("data-vim-mode", "normal");
    expect(await figure()).toBe(null);

    await recordRequests();
    await browser.keys("Enter");
    await expect($(".gloss-prompt-input")).toBeExisting();
    expect(await send(QUESTION)).toBe(true);

    // The answer streams, is saved with its spec, and the gloss draws the plot.
    await until(async () => (await figure())?.drawn === "plot", 45_000, "the plot in the gloss");
    const fig = await figure();
    expect(fig?.inGloss).toBe(true);
    expect(fig?.label).toBe("Plot of y = x^2 for x from -1 to 1");
    expect(fig?.legend).toBe("y = x^2");
    // y = x^2 on [-1, 1]: from the top-left corner (44,10) to the bottom at x = 0 (296,198) and
    // back up (548,10), in the plot's 560 × 220 box; and the spec's 100 points.
    expect(fig?.curve.startsWith("M44,10 L")).toBe(true);
    expect(fig?.curve).toContain(" L296,198 ");
    expect(fig?.curve.endsWith(" L548,10")).toBe(true);
    expect(fig?.points).toBe(100);
    await browser.execute(() => document.querySelector("figure.figure")?.scrollIntoView({ block: "center" }));
    await shot("figure");

    // The lecture file is saved a moment after the last edit (F-021's trailing debounce, D-122),
    // so wait for the gloss to reach it, as gloss.ts does.
    await until(
      async () => readFileSync(file(), "utf8").includes(`**you asked:** ${QUESTION}`),
      15_000,
      "the gloss to be saved",
    );
    const text = readFileSync(file(), "utf8");
    expect(text).toContain(`**you asked:** ${QUESTION}\n\n**Sample answer.**`);
    expect(text).toMatch(/\n```fnplot\n\{"type": "fnplot", "exprs": \["x\^2"\], "x": \[-1, 1\][^\n]*\}\n```\n:::\n/);
  });

  it("drops the drawing out of view and draws it again back in view", async () => {
    expect(await scrollTo("bottom")).toBe(true);
    // Out of view: no plot is drawn anywhere (the figure is empty, or CodeMirror dropped it).
    await until(
      async () => {
        const f = await figure();
        return f === null || (f.visible === "false" && f.svgs === 0);
      },
      15_000,
      "the plot to go out of view",
    );
    expect(await scrollTo("top")).toBe(true);
    await until(async () => (await figure())?.drawn === "plot", 15_000, "the plot to be drawn again");
    expect((await figure())?.svgs).toBe(1);
  });

  it("made no network request for the answer or its figure", async () => {
    const { all, network } = await networkRequests();
    console.log(`figure flow: ${all.length} requests recorded, ${network.length} left the app`);
    for (const url of all) console.log(`  request: ${url}`);
    expect(network).toEqual([]);
  });
});
