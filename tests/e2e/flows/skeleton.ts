// F-026: the walking skeleton end to end in the real app (D-043, 14-quality.md#test-layers), one
// step per test, a screenshot per step: open a course, parse its slide PDF into a lecture, edit the
// lecture, restart the app, search it, ask for a gloss and see the figure in it.
//
// The parse step runs the core's worker path through `lecter-harness parse` (skeleton/lecture.ts):
// the app has no import command until F-061. Everything else goes through the app with keys and
// clicks, as in the flows of each skeleton feature (open-course, buffer, restart, find, gloss,
// figure). The embedded WebDriver sends keys as synthetic events, which can't type text, so text
// goes in through the DOM (execCommand in the editor, input values in the prompts).

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shot } from "../support/shot.ts";
import { buildHarness, lectureFile, parsePdf } from "./skeleton/lecture.ts";
import { quit, relaunch, stop } from "./skeleton/relaunch.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
/** The synthetic two-page text PDF of F-019 (tests/fixtures/pdf/make_fixtures.py). */
const FIXTURE = join(root, "tests", "fixtures", "pdf", "text-two-pages.pdf");
const PDF = "12-entropy.pdf";
const NAME = "2026-10-27-l12-entropy.md";
const STEM = "2026-10-27-l12-entropy";
const TYPED = "Clausius stated it first. ";
const QUESTION = "Can you plot this?";

/** The fixture's text as the parser reads it, written as 03-lecture-files.md#body says. */
const LECTURE = [
  "---",
  "lecter: 1",
  "lecture: 12",
  "date: 2026-10-27",
  "title: Entropy and heat",
  "slides:",
  `  - slides/${PDF}`,
  "---",
  "",
  '::: {.slide #s1 n=1 title="Entropy and heat"}',
  "## Entropy and heat",
  "",
  "[The second law says that the entropy of an isolated system never falls.]{#s1b2}",
  "",
  "[Heat flows from hot to cold.]{#s1b3}",
  "",
  ":::",
  "",
  '::: {.slide #s2 n=2 title="Worked example"}',
  "## Worked example",
  "",
  "[A cup of tea cools in a room. Its entropy falls and the room gains more.]{#s2b2}",
  "",
  ":::",
  "",
].join("\n");
const FIRST = "The second law says that the entropy of an isolated system never falls.";

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

/**
 * The file names in the sidebar's Lectures or Slides list, read in one call: each row's name,
 * without the date a lecture row shows beside it (F-036).
 */
function listed(section: "Lectures" | "Slides"): Promise<string[]> {
  return browser.execute(
    (s: string) =>
      Array.from(document.querySelectorAll(`[aria-label="${s}"] li .sidebar-name`), (n) => n.textContent ?? ""),
    section,
  );
}

/** Opens the course (the dialog answers LECTER_TEST_PICK) and the lecture, with the mouse. */
async function openLecture(): Promise<void> {
  await $("button.rail-add").click();
  await $(`button.course-file-open[data-path="lectures/${NAME}"]`).click();
  await expect($(".lecture-buffer")).toHaveAttribute("data-lecture", `lectures/${NAME}`);
  await expect($(".lecture-buffer")).toHaveAttribute("data-vim-mode", "normal");
}

/** The text of each block in the buffer, in order, read in one call. */
function blocks(): Promise<string[]> {
  return browser.execute(() => Array.from(document.querySelectorAll(".cm-block"), (b) => b.textContent ?? ""));
}

/** Sets `value` in `input` as typing would, then dispatches Enter (with keyCode 13) to it. */
function enter(selector: string, value: string): Promise<boolean> {
  return browser.execute(
    (s: string, v: string) => {
      const input = document.querySelector(s) as HTMLInputElement | HTMLTextAreaElement | null;
      if (!input) return false;
      input.focus();
      input.value = v;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const down = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true });
      Object.defineProperty(down, "keyCode", { get: () => 13 });
      Object.defineProperty(down, "which", { get: () => 13 });
      input.dispatchEvent(down);
      return true;
    },
    selector,
    value,
  );
}

/** The figure in the gloss as the page shows it now, or null. */
function figure(): Promise<{ drawn: string; legend: string; inGloss: boolean } | null> {
  return browser.execute(() => {
    const f = document.querySelector<HTMLElement>("figure.figure");
    if (!f) return null;
    return {
      drawn: f.dataset.drawn ?? "",
      legend: f.querySelector(".figure-legend")?.textContent ?? "",
      // The line above the figure is the closing fence of the spec inside the gloss.
      inGloss: f.previousElementSibling?.textContent === "```",
    };
  });
}

describe("the walking skeleton end to end", function () {
  // Building the harness, a relaunch and a streamed answer (about 6 s), plus the service's waits.
  this.timeout(600_000);

  before(() => {
    mkdirSync(join(course(), "slides"), { recursive: true });
    mkdirSync(join(course(), "lectures"), { recursive: true });
    copyFileSync(FIXTURE, join(course(), "slides", PDF));
    // Only this flow's lectures in the index, so :find lists this lecture's hits alone.
    rmSync(join(course(), ".lecter", "cache", "index"), { recursive: true, force: true });
  });

  // Flows in one shard share the course; others list its lectures and slides exactly.
  after(async () => {
    await stop();
    rmSync(join(course(), "slides", PDF), { force: true });
    rmSync(file(), { force: true });
    rmSync(join(course(), ".lecter", "cache", "index"), { recursive: true, force: true });
    const journal = join(course(), ".lecter", "journal");
    if (existsSync(journal)) {
      for (const f of readdirSync(journal).filter((f) => f.startsWith(STEM))) rmSync(join(journal, f), { force: true });
    }
  });

  it("opens the course and lists its slide PDF", async () => {
    await $("button.rail-add").click();
    await until(async () => (await listed("Slides")).includes(PDF), 15_000, "the slide PDF in the rail");
    expect(await listed("Lectures")).not.toContain(NAME);
    await shot("skeleton-course");
  });

  it("parses the slide PDF into a lecture and opens it", async () => {
    buildHarness();
    const parsed = parsePdf(join(course(), "slides", PDF));
    writeFileSync(file(), lectureFile(parsed, { lecture: 12, date: "2026-10-27", slides: `slides/${PDF}` }));
    expect(readFileSync(file(), "utf8")).toBe(LECTURE);
    await openLecture();
    expect(await blocks()).toEqual([
      FIRST,
      "Heat flows from hot to cold.",
      "A cup of tea cools in a room. Its entropy falls and the room gains more.",
    ]);
    await shot("skeleton-lecture");
  });

  it("edits the lecture with Vim keys and saves it", async () => {
    await expect($(".cm-focused-line")).toHaveText(FIRST, { containing: true });
    await browser.keys("i");
    await expect($(".lecture-buffer")).toHaveAttribute("data-vim-mode", "insert");
    const ok = await browser.execute((t: string) => document.execCommand("insertText", false, t), TYPED);
    expect(ok).toBe(true);
    await browser.keys("Escape");
    await expect($(".lecture-buffer")).toHaveAttribute("data-vim-mode", "normal");
    await until(async () => (await blocks())[0] === `${TYPED}${FIRST}`, 15_000, "the edit in the buffer");
    // Saved through the journal and the debounced atomic write (F-021).
    await until(
      async () => readFileSync(file(), "utf8").includes(`[${TYPED}${FIRST}]{#s1b2}`),
      15_000,
      "the edit to be saved",
    );
    await shot("skeleton-edit");
  });

  it("keeps the edit across a restart", async () => {
    await quit();
    expect(readFileSync(file(), "utf8")).toBe(LECTURE.replace(`[${FIRST}]`, `[${TYPED}${FIRST}]`));
    await relaunch();
    await openLecture();
    expect((await blocks())[0]).toBe(`${TYPED}${FIRST}`);
    await shot("skeleton-restart");
  });

  it("finds the edited block with :find", async () => {
    await browser.keys(":");
    await expect($(".cmdline-input")).toBeExisting();
    expect(await enter(".cmdline-input", "find clausius")).toBe(true);
    const hits = () =>
      browser.execute(() =>
        Array.from(document.querySelectorAll(".find-hit"), (e) => ({
          at: `${e.getAttribute("data-lecture")}#${e.getAttribute("data-block")}`,
          text: e.querySelector(".find-hit-text")?.textContent ?? "",
        })),
      );
    await until(async () => (await hits()).length > 0, 15_000, "the :find hits");
    expect(await hits()).toEqual([{ at: `lectures/${NAME}#s1b2`, text: `${TYPED}${FIRST}` }]);
    await expect($(".find-status")).toHaveText("1 hit for “clausius”");
    await shot("skeleton-search");
  });

  it("asks for a gloss on the block and shows its figure", async () => {
    // Back to the buffer: the cursor is still on the edited block.
    await browser.execute(() => (document.querySelector(".cm-content") as HTMLElement | null)?.focus());
    await expect($(".cm-focused-line")).toHaveText(`${TYPED}${FIRST}`, { containing: true });
    // Enter asks (10-keymap.md#on-a-slide-line, F-048).
    await browser.keys("Enter");
    await expect($(".gloss-prompt-input")).toBeExisting();
    await shot("ask-enter");
    expect(await enter(".gloss-prompt-input", QUESTION)).toBe(true);
    await until(
      async () => browser.execute(() => (document.querySelector(".gloss .gloss-body")?.textContent ?? "").length > 20),
      20_000,
      "the first words of the answer",
    );
    const anchor = await browser.execute(() => document.querySelector<HTMLElement>(".gloss")?.dataset.anchor ?? "");
    expect(anchor).toBe("s1b2");
    await shot("skeleton-gloss");

    await until(async () => (await figure())?.drawn === "plot", 45_000, "the plot in the gloss");
    expect(await figure()).toEqual({ drawn: "plot", legend: "y = x^2", inGloss: true });
    await browser.execute(() => document.querySelector("figure.figure")?.scrollIntoView({ block: "center" }));
    await shot("skeleton-figure");
    // The gloss, with its spec, is saved under the edited block (03-lecture-files.md#body).
    await until(
      async () => readFileSync(file(), "utf8").includes(`**you asked:** ${QUESTION}`),
      15_000,
      "the gloss to be saved",
    );
    const text = readFileSync(file(), "utf8");
    expect(text).toMatch(/\n::: \{\.gloss #g-[0-9a-f]{4} kind=ask key=Enter anchor=s1b2 model="sample" by=ai\}\n/);
    expect(text).toMatch(/\n```fnplot\n\{"type": "fnplot", "exprs": \["x\^2"\][^\n]*\}\n```\n:::\n/);
  });
});
