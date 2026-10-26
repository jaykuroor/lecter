// F-020: a lecture opens from the rail into the buffer (03-lecture-files.md#body,
// components.md#slide-heading, #block) and moves with Vim keys in normal mode: j, k, gg and G
// between blocks, i and Esc between insert and normal mode (10-keymap.md#move-everywhere).
// The embedded WebDriver sends keys as synthetic KeyboardEvents to the focused element, which is
// what CodeMirror's Vim handles; it can't type text (no native default action), so typing is
// covered by the Playwright spec (ui/e2e/buffer.spec.ts).

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { shot } from "../support/shot.ts";

const NAME = "2026-10-23-l07-covariance.md";

// A synthetic lecture as Lecter writes it: front matter, slide divs with a title line, one span
// per block (03-lecture-files.md). English only.
const LECTURE = [
  "---",
  "lecter: 1",
  "lecture: 7",
  "date: 2026-10-23",
  "title: Covariance and Correlation",
  "slides:",
  "  - slides/07-covariance.pdf",
  "---",
  "",
  '::: {.slide #s1 n=1 src="A1" title="Covariance"}',
  "## Covariance",
  "",
  "[Covariance measures how two variables move together.]{#s1b1}",
  "",
  "[It is zero for independent variables.]{#s1b2}",
  "",
  ":::",
  "",
  '::: {.slide #s2 n=2 src="A2" title="Properties"}',
  "## Properties",
  "",
  "[Covariance is bilinear in each argument.]{#s2b1}",
  "",
  "[Variance of a sum adds twice the covariance.]{#s2b2 .flag}",
  "",
  ":::",
  "",
].join("\n");

function course(): string {
  const dir = process.env.LECTER_TEST_PICK;
  if (!dir) throw new Error("LECTER_TEST_PICK is not set: run flows through scripts/e2e-app.sh");
  return dir;
}

const buffer = () => $(".lecture-buffer");
const focused = () => $(".cm-focused-line");

/**
 * The text of every element matching `selector`, read in the page in one call. CodeMirror
 * re-renders its lines and widgets, so element references held across calls can go stale; and
 * `textContent` is the DOM text, without CSS `text-transform` (the slide label is uppercase on
 * screen).
 */
function texts(selector: string): Promise<string[]> {
  return browser.execute((s: string) => Array.from(document.querySelectorAll(s), (e) => e.textContent ?? ""), selector);
}

/** Waits until the elements matching `selector` hold exactly `expected`, in order. */
async function expectTexts(selector: string, expected: string[]): Promise<void> {
  const want = JSON.stringify(expected);
  await browser
    .waitUntil(async () => JSON.stringify(await texts(selector)) === want, {
      timeoutMsg: `${selector} never read ${want}`,
    })
    .catch(() => undefined);
  expect(await texts(selector)).toEqual(expected);
}

/** Presses keys one at a time, as typed. */
async function press(...keys: string[]): Promise<void> {
  for (const k of keys) await browser.keys(k);
}

describe("lecture buffer", () => {
  before(() => {
    mkdirSync(join(course(), "lectures"), { recursive: true });
    writeFileSync(join(course(), "lectures", NAME), LECTURE);
  });

  // Other flows list this course's lectures exactly.
  after(() => rmSync(join(course(), "lectures", NAME), { force: true }));

  it("opens the lecture from the rail with Enter and shows its slides and blocks", async () => {
    const focusedOpen = await browser.execute(() => {
      const button = document.querySelector("button.course-open") as HTMLButtonElement | null;
      button?.focus();
      return document.activeElement === button && button !== null;
    });
    expect(focusedOpen).toBe(true);
    await browser.keys("Enter");
    const lecture = $(`button.course-file-open=${NAME}`);
    await expect(lecture).toBeDisplayed();
    await browser.execute((name: string) => {
      const rows = [...document.querySelectorAll<HTMLButtonElement>("button.course-file-open")];
      rows.find((b) => b.textContent === name)?.focus();
    }, NAME);
    await browser.keys("Enter");

    await expect(buffer()).toHaveAttribute("data-lecture", `lectures/${NAME}`);
    await expectTexts(".slide-heading-label", ["Slide 1 / 2", "Slide 2 / 2"]);
    await expectTexts(".slide-heading-title", ["Covariance", "Properties"]);
    await expectTexts(".cm-block", [
      "Covariance measures how two variables move together.",
      "It is zero for independent variables.",
      "Covariance is bilinear in each argument.",
      "Variance of a sum adds twice the covariance.",
    ]);
    await expect(focused()).toHaveText("Covariance measures how two variables move together.");
    await expect(buffer()).toHaveAttribute("data-vim-mode", "normal");
    await shot("buffer");
  });

  it("moves between blocks with j, k, gg and G in normal mode", async () => {
    await press("j");
    await expect(focused()).toHaveText("It is zero for independent variables.");
    await press("j");
    await expect(focused()).toHaveText("Covariance is bilinear in each argument.");
    await press("k");
    await expect(focused()).toHaveText("It is zero for independent variables.");
    await press("G");
    await expect(focused()).toHaveText("Variance of a sum adds twice the covariance.");
    await press("g", "g");
    await expect(focused()).toHaveText("Covariance measures how two variables move together.");
  });

  it("switches to insert mode with i and back to normal with Esc", async () => {
    await press("i");
    await expect(buffer()).toHaveAttribute("data-vim-mode", "insert");
    await shot("buffer-insert");
    await press("Escape");
    await expect(buffer()).toHaveAttribute("data-vim-mode", "normal");
    // Normal mode again: j moves instead of typing.
    await press("j");
    await expect(focused()).toHaveText("It is zero for independent variables.");
  });

  it("opens the lecture with the mouse too", async () => {
    await $("button.course-open").click();
    await $(`button.course-file-open=${NAME}`).click();
    await expect(focused()).toHaveText("Covariance measures how two variables move together.");
    await expect(buffer()).toHaveAttribute("data-vim-mode", "normal");
  });
});
