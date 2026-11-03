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

/** What the page keeps for these checks, on `window.__idle`. */
interface Probe {
  /** performance.now() of the last keydown or mousedown anywhere in the window. */
  lastInput: number;
  /** Set while a window is open: its start, and each mutation and frame callback in it. */
  watch?: { start: number; mutations: { t: number; what: string }[]; frames: number[] };
}

/** Starts the page's input clock and the frame counter (requestAnimationFrame, wrapped). */
function installProbe(): Promise<void> {
  return browser.execute(() => {
    const w = window as unknown as { __idle?: Probe; requestAnimationFrame: typeof requestAnimationFrame };
    if (w.__idle) return;
    const probe: Probe = { lastInput: performance.now() };
    w.__idle = probe;
    const input = () => {
      probe.lastInput = performance.now();
    };
    window.addEventListener("keydown", input, true);
    window.addEventListener("mousedown", input, true);
    const raf = window.requestAnimationFrame.bind(window);
    w.requestAnimationFrame = (cb: FrameRequestCallback) =>
      raf((t) => {
        probe.watch?.frames.push(performance.now());
        cb(t);
      });
  });
}

/** Milliseconds since the last key or click, as the page saw it. */
function sinceInput(): Promise<number> {
  return browser.execute(() => {
    const probe = (window as unknown as { __idle?: Probe }).__idle;
    return probe ? performance.now() - probe.lastInput : -1;
  });
}

/** Keeps still until `ms` have passed since the later of the last input and `since` (page time). */
async function idleFor(ms: number, since = 0): Promise<void> {
  const elapsed = await browser.execute((from: number) => {
    const probe = (window as unknown as { __idle?: Probe }).__idle;
    return performance.now() - Math.max(probe?.lastInput ?? 0, from);
  }, since);
  if (elapsed < ms) await browser.pause(Math.ceil(ms - elapsed) + 50);
}

/**
 * Waits (in the page, at most 15 s) for every animation and transition now in the window to
 * finish, and returns how long after the later of the last input and `since` the last one ended
 * (0 when none was left), and any still running.
 */
async function animationsEnd(since: number): Promise<{ endedAfterInput: number; stillRunning: string[] }> {
  return await browser.execute(async (since: number) => {
    const probe = (window as unknown as { __idle?: Probe }).__idle;
    const from = Math.max(probe?.lastInput ?? 0, since);
    const animations = document.getAnimations();
    let last = from;
    const ends = animations.map((a) =>
      a.finished.then(
        () => {
          last = Math.max(last, performance.now());
        },
        () => undefined, // cancelled: it ends too
      ),
    );
    const timeout = new Promise((resolve) => setTimeout(resolve, 15_000));
    await Promise.race([Promise.all(ends), timeout]);
    const stillRunning = animations
      .filter((a) => a.playState === "running")
      .map((a) => {
        const target = a.effect instanceof KeyframeEffect ? a.effect.target : null;
        return target instanceof Element ? target.className : "?";
      });
    return { endedAfterInput: last - from, stillRunning };
  }, since);
}

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

/** Whether the window and the editor have focus: the caret only blinks in a focused editor. */
function focus(): Promise<{ document: boolean; editor: boolean }> {
  return browser.execute(() => ({
    document: document.hasFocus(),
    editor: document.querySelector(".cm-editor")?.classList.contains("cm-focused") ?? false,
  }));
}

/** Asserts focus first, so that a caret that doesn't blink for want of focus says so. */
async function expectFocused(): Promise<void> {
  expect(await focus()).toEqual({ document: true, editor: true });
}

/**
 * Clicks the editor line that reads `text` once, as a mouse does: pointerdown, mousedown,
 * pointerup, mouseup, click, all with `detail: 1` (a single click), at the centre of the line's
 * second character, measured in the page so it holds whatever the fonts make of the line. Before
 * dispatching it checks that the element at that point is inside the line, and throws if not.
 * The embedded WebDriver can't click like this: its element click (`$(…).click()`) sends only a
 * lone `click`, which no real mouse sends and which neither CodeMirror (selection on mousedown)
 * nor the caret (restart on mousedown) acts on; its pointer actions send `detail: 0`, which
 * CodeMirror counts as a triple click and turns into a whole-line selection, so Vim leaves normal
 * mode.
 */
async function clickLine(text: string): Promise<void> {
  const result = await browser.execute((want: string) => {
    const line = [...document.querySelectorAll<HTMLElement>(".cm-line")].find((l) => l.textContent === want);
    if (!line) return { error: `no editor line reads "${want}"` };
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let textNode: Text | null = null;
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      if (n instanceof Text && n.data.trim().length >= 3) {
        textNode = n;
        break;
      }
    }
    if (!textNode) return { error: `the line "${want}" has no text to click` };
    const range = document.createRange();
    range.setStart(textNode, 1);
    range.setEnd(textNode, 2);
    const char = range.getBoundingClientRect();
    const x = char.left + char.width / 2;
    const y = char.top + char.height / 2;
    const hit = document.elementFromPoint(x, y);
    const point = `(${Math.round(x)}, ${Math.round(y)})`;
    if (!hit || !line.contains(hit)) {
      const on = hit ? `${hit.nodeName.toLowerCase()}.${hit.className}` : "nothing";
      return { error: `the point ${point} is on ${on}, not on the line "${want}"` };
    }
    const at = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, detail: 1 };
    const pointer = { ...at, pointerId: 1, pointerType: "mouse", isPrimary: true };
    hit.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1 }));
    hit.dispatchEvent(new MouseEvent("mousedown", { ...at, buttons: 1 }));
    hit.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0 }));
    hit.dispatchEvent(new MouseEvent("mouseup", { ...at, buttons: 0 }));
    hit.dispatchEvent(new MouseEvent("click", { ...at, buttons: 0 }));
    return { point };
  }, text);
  if ("error" in result) throw new Error(`clickLine: ${result.error}`);
  console.log(`IDLE click at ${result.point} on "${text}"`);
}

/** The buffer's Vim mode and the focused line's text. */
function cursor(): Promise<{ mode: string; line: string }> {
  return browser.execute(() => ({
    mode: document.querySelector<HTMLElement>(".lecture-buffer")?.dataset.vimMode ?? "",
    line: document.querySelector(".cm-focused-line")?.textContent ?? "",
  }));
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

/** Waits briefly (2 s) for the caret to blink after an input, then asserts it does. */
async function expectBlinking(after: string): Promise<void> {
  await browser
    .waitUntil(async () => (await caretBlinks()) > 0, { timeout: 2_000, interval: 50 })
    .catch(() => undefined);
  const blinks = await caretBlinks();
  console.log(`IDLE caret animations right after ${after}: ${blinks}`);
  expect(blinks).toBeGreaterThan(0);
}

/** Running animations and transitions in the main window: kind and target. */
function running(): Promise<string[]> {
  return browser.execute(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === "running")
      .map((a) => {
        const target = a.effect instanceof KeyframeEffect ? a.effect.target : null;
        const name = "animationName" in a ? `css-animation ${String(a.animationName)}` : "";
        const prop = "transitionProperty" in a ? `transition ${String(a.transitionProperty)}` : "";
        return `${name || prop || "animation"} on ${target instanceof Element ? target.className : "?"}`;
      }),
  );
}

/** How many running animations are on CodeMirror's caret layers. */
async function caretBlinks(): Promise<number> {
  return (await running()).filter((a) => a.includes("cm-cursorLayer")).length;
}

/** The caret as drawn: Vim's block cursor in normal mode (opacity of its layer, size, display). */
function caret(): Promise<{ opacity: string; display: string; width: number; height: number } | null> {
  return browser.execute(() => {
    const layer = document.querySelector<HTMLElement>(".cm-vimCursorLayer");
    const cursor = layer?.querySelector<HTMLElement>(".cm-fat-cursor");
    if (!layer || !cursor) return null;
    const box = cursor.getBoundingClientRect();
    return {
      opacity: getComputedStyle(layer).opacity,
      display: getComputedStyle(cursor).display,
      width: Math.round(box.width),
      height: Math.round(box.height),
    };
  });
}

/** Opens the mutation and frame window now. */
function openWindow(): Promise<void> {
  return browser.execute(() => {
    const probe = (window as unknown as { __idle?: Probe }).__idle;
    if (!probe) return;
    const watch = { start: performance.now(), mutations: [] as { t: number; what: string }[], frames: [] as number[] };
    probe.watch = watch;
    const observer = new MutationObserver((records) => {
      const t = performance.now();
      for (const r of records) {
        const target = r.target instanceof Element ? r.target.className : r.target.nodeName;
        watch.mutations.push({ t, what: `${r.type} ${r.attributeName ?? ""} on ${target}` });
      }
    });
    observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    (window as unknown as { __idleObserver?: MutationObserver }).__idleObserver = observer;
  });
}

/** Closes the window and returns what happened within its first `ms`. */
function closeWindow(ms: number): Promise<{ lasted: number; mutations: string[]; frames: number }> {
  return browser.execute((length: number) => {
    const w = window as unknown as { __idle?: Probe; __idleObserver?: MutationObserver };
    w.__idleObserver?.disconnect();
    const watch = w.__idle?.watch;
    if (!w.__idle || !watch) return { lasted: 0, mutations: ["no window was open"], frames: 0 };
    w.__idle.watch = undefined;
    const end = watch.start + length;
    return {
      lasted: performance.now() - watch.start,
      mutations: watch.mutations.filter((m) => m.t <= end).map((m) => m.what),
      frames: watch.frames.filter((t) => t <= end).length,
    };
  }, ms);
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
