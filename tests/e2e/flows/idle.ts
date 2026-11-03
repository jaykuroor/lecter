// F-029: nothing redraws while idle (14-quality.md#performance-budgets, 09-ui.md#editing, D-146).
// With a lecture open, 10 s after the last key or click the window runs no animation or
// transition, and over the next 30 s a MutationObserver on the document records nothing and no
// requestAnimationFrame callback runs. The caret blinks for those 10 s, then stays solid and
// visible until the next key or click, which makes it blink again. A streaming gloss still
// paints, and the same checks hold 10 s after the stream ends.
//
// The idle windows are measurements, not synchronisation: the flow keeps still for them on
// purpose. The page clocks the last key or click itself (a capture listener on the window), so the
// 10 s count from the input as the app saw it, not from when WebDriver returned. Nothing talks to
// the page during a window; each mutation and frame is time-stamped in the page, and only those
// inside the window count, so the WebDriver calls that open and close it can't be mistaken for
// idle work. A window is opened and read in two calls because WebDriver scripts time out at 30 s.
// Before a window opens, the flow waits for the page's animations to finish (their `finished`
// promises): an animation's clock starts at the frame after the key, which a slow software
// renderer can push past 10 s by tens of milliseconds. That they ended within 10 s plus one second
// of slack is asserted; the window itself still starts no earlier than 10 s after the input.

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { shot } from "../support/shot.ts";
import { attribute, reporter, save } from "./idle-cpu/attribution.ts";
import { verdict } from "./idle-cpu/budget.ts";
import {
  animationsEnd,
  caret,
  caretBlinks,
  caretDiagnosis,
  clickLine,
  closeWindow,
  cursor,
  focus,
  idleFor,
  installProbe,
  nativeCaret,
  openWindow,
  running,
  sinceInput,
} from "./idle-page/probe.ts";

const NAME = "2026-10-27-l11-idle.md";
const STEM = "2026-10-27-l11-idle";
/** The caret blinks this long after the last input; the idle checks start then (D-146). */
const BLINK_MS = 10_000;
/** The mutation and frame window (criterion 2). */
const WINDOW_MS = 30_000;
/** Slack for an animation's start: it begins at the first frame after the key that started it. */
const START_SLACK_MS = 1_000;
/** How long the stream's painting is sampled, frame by frame (criterion 4). */
const PAINT_SAMPLE_MS = 2_000;
const QUESTION = "Why does correlation have no units?";
const FIRST_BLOCK = "Correlation is covariance divided by both standard deviations.";

// A synthetic lecture as Lecter writes it (03-lecture-files.md). English only.
const LECTURE = [
  "---",
  "lecter: 1",
  "lecture: 11",
  "date: 2026-10-27",
  "title: Correlation",
  "---",
  "",
  '::: {.slide #s1 n=1 src="A1" title="Correlation"}',
  "## Correlation",
  "",
  "[Correlation is covariance divided by both standard deviations.]{#s1b1}",
  "",
  "[It always lies between minus one and one.]{#s1b2}",
  "",
  ":::",
  "",
].join("\n");

function course(): string {
  const dir = process.env.LECTER_TEST_PICK;
  if (!dir) throw new Error("LECTER_TEST_PICK is not set: run flows through scripts/e2e-app.sh");
  return dir;
}

const file = () => join(course(), "lectures", NAME);

/**
 * Waits for the blink to end and asserts it did within 10 s (plus slack) of the later of the last
 * input and `since` (a stream's end, when the editor may get its focus back and blink again).
 */
async function expectBlinkEnds(label: string, since = 0): Promise<void> {
  const end = await animationsEnd(since);
  console.log(
    `IDLE ${label}: animations ended ${Math.round(end.endedAfterInput)} ms after the last input ${end.stillRunning.join("; ")}`,
  );
  expect(end.stillRunning).toEqual([]);
  expect(end.endedAfterInput).toBeLessThanOrEqual(BLINK_MS + START_SLACK_MS);
}

/** Asserts focus first, so that a caret that doesn't blink for want of focus says so. */
async function expectFocused(): Promise<void> {
  expect(await focus()).toEqual({ document: true, editor: true });
}

/** Opens this flow's lecture from the rail, unless it is open already. */
async function openLecture(): Promise<void> {
  const open = await browser.execute(
    () => document.querySelector<HTMLElement>(".lecture-buffer")?.dataset.lecture ?? "",
  );
  if (open !== `lectures/${NAME}`) {
    await $("button.course-open").click();
    await $(`button.course-file-open=${NAME}`).click();
  }
  await expect($(".lecture-buffer")).toHaveAttribute("data-lecture", `lectures/${NAME}`);
  await installProbe();
}

/**
 * Puts the cursor on the lecture's first slide line in normal mode, whatever an earlier test left:
 * Esc (out of insert or visual mode), then gg.
 */
async function toFirstSlideLine(): Promise<void> {
  await openLecture();
  await browser.keys("Escape");
  await browser.keys("g");
  await browser.keys("g");
  const want = { mode: "normal", line: FIRST_BLOCK };
  await browser
    .waitUntil(async () => JSON.stringify(await cursor()) === JSON.stringify(want), { timeout: 5_000, interval: 50 })
    .catch(() => undefined);
  expect(await cursor()).toEqual(want);
}

/**
 * After an input: the caret blinks (polled for up to 2 s), or, where the webview reports
 * `prefers-reduced-motion: reduce`, it stays solid and visible with nothing animating, because
 * caret.ts never blinks under reduced motion (ui/CLAUDE.md: reduced-motion support). Logs what
 * decided it either way.
 */
async function expectBlinking(after: string): Promise<void> {
  const before = await caretDiagnosis();
  if (before.reducedMotion === true) {
    const blinks = await caretBlinks();
    const solid = await caret();
    console.log(
      `IDLE caret after ${after}: reduced motion is on, so the blink half is skipped; caret ${JSON.stringify(solid)}; ${JSON.stringify(before)}`,
    );
    expect(blinks).toBe(0);
    expect(solid?.opacity).toBe("1");
    expect(solid?.display).not.toBe("none");
    expect(solid?.width ?? 0).toBeGreaterThan(0);
    expect(solid?.height ?? 0).toBeGreaterThan(0);
    return;
  }
  await browser
    .waitUntil(async () => (await caretBlinks()) > 0, { timeout: 2_000, interval: 50 })
    .catch(() => undefined);
  const blinks = await caretBlinks();
  console.log(`IDLE caret animations right after ${after}: ${blinks}; ${JSON.stringify(await caretDiagnosis())}`);
  expect(blinks).toBeGreaterThan(0);
}

/** The idle checks (criteria 1 and 2), starting 10 s after the last input and `since`. */
async function expectIdle(label: string, since = 0): Promise<void> {
  await expectBlinkEnds(label, since);
  await idleFor(BLINK_MS, since);
  await openWindow();
  const animations = await running();
  console.log(
    `IDLE ${label}: running animations 10 s after the last input: ${animations.length} ${animations.join("; ")}`,
  );
  expect(animations).toEqual([]);
  await browser.pause(WINDOW_MS);
  const seen = await closeWindow(WINDOW_MS);
  console.log(
    `IDLE ${label}: over ${(seen.lasted / 1000).toFixed(1)} s: ${seen.mutations.length} mutations, ${seen.frames} frame callbacks ${seen.mutations.slice(0, 5).join("; ")}`,
  );
  expect(seen.lasted).toBeGreaterThanOrEqual(WINDOW_MS);
  expect(seen.mutations).toEqual([]);
  expect(seen.frames).toBe(0);
  // F-180: the webview's own caret blink was the idle redraw. The focused editor is parked: not
  // contenteditable, so the engine runs no caret blink, while it keeps the focus and the caret.
  const native = await nativeCaret();
  console.log(`IDLE ${label}: native caret ${JSON.stringify(native)}`);
  expect(native).toEqual({ focused: true, editable: "false", tabindex: "0", selection: "Caret" });
}

/** The gloss card's state and answer text, or null when there is none. */
function card(): Promise<{ state: string; text: string } | null> {
  return browser.execute(() => {
    const c = document.querySelector<HTMLElement>(".gloss");
    if (!c) return null;
    return { state: c.dataset.state ?? "", text: c.querySelector(".gloss-body")?.textContent ?? "" };
  });
}

describe("an idle lecture", function () {
  // Three idle windows of 40 s each, and the service's window-focus waits before finds and clicks.
  this.timeout(300_000);

  before(() => {
    mkdirSync(join(course(), "lectures"), { recursive: true });
    writeFileSync(file(), LECTURE);
  });

  // Other flows list this course's lectures exactly; the gloss in the last test left a journal.
  after(() => {
    rmSync(file(), { force: true });
    const journal = join(course(), ".lecter", "journal");
    if (existsSync(journal)) {
      for (const f of readdirSync(journal).filter((f) => f.startsWith(STEM))) rmSync(join(journal, f), { force: true });
    }
  });

  it("runs no animation, DOM change or frame 10 s after the last key, with the caret solid", async () => {
    await toFirstSlideLine();
    await expectFocused();
    await browser.keys("j");
    expect(await sinceInput()).toBeLessThan(BLINK_MS);
    expect((await cursor()).mode).toBe("normal");
    await expectBlinking("j");

    await expectIdle("after a key");
    // Stopped, and visible: the block cursor shows at full opacity.
    const solid = await caret();
    console.log(`IDLE caret after 10 s: ${JSON.stringify(solid)}`);
    expect(solid?.opacity).toBe("1");
    expect(solid?.display).not.toBe("none");
    expect(solid?.width ?? 0).toBeGreaterThan(0);
    expect(solid?.height ?? 0).toBeGreaterThan(0);
    await shot("idle-caret-solid");
  });

  it("blinks again at the next key and the next click, then stops 10 s later", async () => {
    await toFirstSlideLine();
    await expectBlinkEnds("before Esc");
    await idleFor(BLINK_MS);
    expect(await caretBlinks()).toBe(0);
    await expectFocused();
    // Esc in normal mode moves nothing; it is still a key.
    await browser.keys("Escape");
    await expectBlinking("Esc");
    await expectBlinkEnds("after Esc");
    await idleFor(BLINK_MS);
    expect(await running()).toEqual([]);

    await clickLine(FIRST_BLOCK);
    await expectFocused();
    // A single click puts the cursor on the line; it doesn't select it.
    expect(await cursor()).toEqual({ mode: "normal", line: FIRST_BLOCK });
    await expectBlinking("a click");
    await expectBlinkEnds("after a click");
    await idleFor(BLINK_MS);
    expect(await running()).toEqual([]);
    expect((await caret())?.opacity).toBe("1");
  });

  it("paints a streaming gloss, and is idle again 10 s after the stream ends", async () => {
    // `a` asks on a slide line in normal mode (10-keymap.md#on-a-slide-line).
    await toFirstSlideLine();
    await browser.keys("a");
    await expect($(".gloss-prompt-input")).toBeExisting();
    const sent = await browser.execute((q: string) => {
      const input = document.querySelector<HTMLTextAreaElement>(".gloss-prompt-input");
      if (!input) return false;
      input.value = q;
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }),
      );
      return true;
    }, QUESTION);
    expect(sent).toBe(true);

    // The sample provider sends a word every 90 ms after 400 ms (crates/ai/src/provider/scripted.rs,
    // about 60 words). Once the first words show, the page reads the card at every frame for 2 s:
    // the answer on screen grows step by step, about 20 words' worth.
    await browser.waitUntil(async () => (await card())?.state === "streaming", {
      timeout: 20_000,
      interval: 50,
      timeoutMsg: "the answer never started streaming",
    });
    const lengths = await browser.execute(async (ms: number) => {
      const seen: number[] = [];
      const start = performance.now();
      while (performance.now() - start < ms) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const c = document.querySelector<HTMLElement>(".gloss");
        if (c?.dataset.state !== "streaming") break;
        const n = c.querySelector(".gloss-body")?.textContent?.length ?? 0;
        if (n !== seen.at(-1)) seen.push(n);
      }
      return seen;
    }, PAINT_SAMPLE_MS);
    console.log(`IDLE stream: answer lengths painted while streaming: ${lengths.join(", ")}`);
    expect(lengths.length).toBeGreaterThanOrEqual(3);
    expect(lengths).toEqual([...lengths].sort((a, b) => a - b));

    await browser.waitUntil(async () => (await card()) === null, {
      timeout: 30_000,
      interval: 100,
      timeoutMsg: "the answer never finished",
    });
    const ended = await browser.execute(() => performance.now());
    const buffer = await browser.execute(() => document.querySelector(".cm-content")?.textContent ?? "");
    expect(buffer).toContain(`**you asked:** ${QUESTION}`);
    await expectIdle("after a stream", ended);
  });
});

// F-180: the idle attribution and idle_cpu_pct on the release app (idle-cpu/attribution.ts). Last
// in this flow: it closes the service's debug app and starts its own. Criterion 1: the
// `idle-attribution` lines (per-process and per-thread CPU every 15 s, the page's counters).
// Criterion 2: idle_cpu_pct < 0.5 % on Linux and macOS (idle-cpu/budget.ts); Windows reports.
// Criterion 3: the source it found, the webview's native caret blinking in the focused editor,
// would show here as CPU on Linux and macOS, and in the tests above as an editable editor.
describe("an idle release build", function () {
  // The release build (minutes the first time), a minute's settle and the 5-minute window.
  this.timeout(40 * 60_000);

  it("uses under 0.5 % of a core over 5 idle minutes, and says where any CPU went", async () => {
    const { report, lines } = reporter();
    try {
      const { pct, page } = await attribute(report);
      const v = verdict(pct, process.platform);
      report(`idle-attribution result: ${v.line}`);
      // The measured state is the one a user leaves: the lecture's editor focused, and parked.
      expect(page.focus.editorFocused).toBe(true);
      expect(page.focus.editable).toBe("false");
      // Nothing in the page ran during the window.
      expect(page.frames).toBe(0);
      expect(page.mutations).toBe(0);
      expect(page.animationEvents).toBe(0);
      expect(page.running).toEqual([]);
      expect(v.outcome).not.toBe("fail");
    } finally {
      save(lines);
    }
  });
});
