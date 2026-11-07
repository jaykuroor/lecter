// F-023: one gloss from the provider in the real app. Enter on a slide block opens the prompt row,
// Enter streams the answer of the offline sample provider under the block, and the finished gloss
// is saved in the lecture file as a fenced div (03-lecture-files.md#body). A second ask is stopped
// with Esc while it streams: the card stops at once, the core's `stopped` comes back within 50 ms,
// and the answer so far is saved.
//
// The embedded WebDriver sends keys as synthetic KeyboardEvents: the key engine reads Enter from
// them, but they can't type text. So the question goes into the prompt's textarea through the DOM,
// and Enter and Esc are dispatched in the page (Esc together with the timing, in one call).

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { shot } from "../support/shot.ts";

const NAME = "2026-10-26-l10-gloss.md";
const STEM = "2026-10-26-l10-gloss";
const QUESTION = "Why is covariance bilinear?";
const SECOND = "And what does that buy us?";
/** Esc must stop the stream within this (criterion 4). */
const CANCEL_LIMIT_MS = 50;

// A synthetic lecture as Lecter writes it (03-lecture-files.md). English only.
const LECTURE = [
  "---",
  "lecter: 1",
  "lecture: 10",
  "date: 2026-10-26",
  "title: Covariance",
  "---",
  "",
  '::: {.slide #s1 n=1 src="A1" title="Properties"}',
  "## Properties",
  "",
  "[Covariance is bilinear in each argument.]{#s1b1}",
  "",
  "[Variance of a sum adds twice the covariance.]{#s1b2}",
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

/** The gloss card's state and text, read in one call (CodeMirror re-renders widgets). */
function card(): Promise<{ state: string; anchor: string; text: string } | null> {
  return browser.execute(() => {
    const c = document.querySelector<HTMLElement>(".gloss");
    if (!c) return null;
    return {
      state: c.dataset.state ?? "",
      anchor: c.dataset.anchor ?? "",
      text: c.querySelector(".gloss-body")?.textContent ?? "",
    };
  });
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

/** Polls `done` with a deadline. */
async function until(done: () => Promise<boolean>, timeout: number, what: string): Promise<void> {
  await browser.waitUntil(done, { timeout, interval: 100, timeoutMsg: `timed out waiting for ${what}` });
}

/** The fenced divs of glosses on `block` in the saved file, in order. */
function savedGlosses(block: string): string[] {
  const text = readFileSync(file(), "utf8");
  return [...text.matchAll(/^::: \{\.gloss [^}]*\}\n[\s\S]*?\n:::$/gm)]
    .map((m) => m[0])
    .filter((d) => d.includes(` anchor=${block} `));
}

describe("a gloss from the provider", function () {
  // The service's window-focus check adds up to ~10 s of waits before every find and click.
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

  it("streams an answer under the block after Enter, a question and Enter, and saves it", async () => {
    await $("button.rail-add").click();
    await $(`button.course-file-open[data-path="lectures/${NAME}"]`).click();
    await expect($(".lecture-buffer")).toHaveAttribute("data-lecture", `lectures/${NAME}`);
    await expect($(".lecture-buffer")).toHaveAttribute("data-vim-mode", "normal");

    await browser.keys("Enter");
    await expect($(".gloss-prompt-input")).toBeExisting();
    expect(await card()).toEqual({ state: "prompt", anchor: "s1b1", text: "" });
    await shot("gloss-prompt");
    expect(await send(QUESTION)).toBe(true);

    // Mid-stream: some words are on screen, the stream is still going.
    await until(async () => ((await card())?.text.length ?? 0) > 20, 20_000, "the first words");
    const streaming = await card();
    expect(streaming?.state).toBe("streaming");
    expect(streaming?.text.startsWith("**Sample answer.**")).toBe(true);
    await shot("gloss-streaming");

    // Done: the card gives way to the gloss in the buffer, and the lecture file holds its div.
    await until(async () => (await card()) === null, 30_000, "the answer to finish");
    const buffer = await browser.execute(() => document.querySelector(".cm-content")?.textContent ?? "");
    expect(buffer).toContain(`**you asked:** ${QUESTION}`);
    await until(async () => savedGlosses("s1b1").length === 1, 15_000, "the gloss to be saved");
    const [div] = savedGlosses("s1b1");
    expect(div).toMatch(/^::: \{\.gloss #g-[0-9a-f]{4} kind=ask key=Enter anchor=s1b1 model="sample" by=ai\}\n/);
    expect(div).toContain(`\n**you asked:** ${QUESTION}\n\n**Sample answer.** No AI provider is connected yet`);
    expect(div?.endsWith("Press Esc while an answer streams to stop it.\n:::")).toBe(true);
    await shot("gloss-done");
  });

  it("stops a streaming answer on Esc within 50 ms and keeps what arrived", async () => {
    await browser.keys("Enter");
    await expect($(".gloss-prompt-input")).toBeExisting();
    expect(await send(SECOND)).toBe(true);
    await until(async () => ((await card())?.text.length ?? 0) > 20, 20_000, "the first words");

    // Esc in the buffer, timed in the page: the card stops at once, and the core's `stopped`
    // (which saves the answer and removes the card) follows.
    const timing = await browser.execute(async () => {
      const content = document.querySelector(".cm-content");
      const c = document.querySelector<HTMLElement>(".gloss");
      if (!content || !c) return null;
      const t0 = performance.now();
      content.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }),
      );
      const stoppedNow = c.dataset.state === "stopped";
      const shown = c.querySelector(".gloss-body")?.textContent ?? "";
      while (c.isConnected && performance.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 1));
      return { stoppedNow, shown, coreMs: performance.now() - t0 };
    });
    console.log(`gloss cancel (real app): Esc to the core's stopped event in ${timing?.coreMs.toFixed(1)} ms`);
    expect(timing?.stoppedNow).toBe(true);
    expect(timing?.coreMs).toBeLessThan(CANCEL_LIMIT_MS);

    // The answer so far is saved after the first gloss: part of the sample, not all of it.
    await until(async () => savedGlosses("s1b1").length === 2, 15_000, "the stopped gloss to be saved");
    const second = savedGlosses("s1b1")[1] ?? "";
    expect(second).toContain(`\n**you asked:** ${SECOND}\n\n**Sample answer.**`);
    expect(second).not.toContain("Press Esc while an answer streams to stop it.");
    expect(second).toContain((timing?.shown ?? "").trim());
  });
});
