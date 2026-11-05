// F-022: `:find <words>` in the real app lists the hits the core's Tantivy index ranks
// (05-retrieval.md#search). The flow opens a lecture (which indexes it), runs `:find variables` on
// Lecter's command line (F-040: `:` in normal mode opens it; it hands `find` to Vim's Ex table) and
// reads the hits in the side panel, best first; then searches with the Find field and its button
// (the mouse path).
//
// The embedded WebDriver sends keys as synthetic KeyboardEvents: Vim reads `:` from them and opens
// the command line, but they can't type text (no native default action). So the words go into the
// command line's input through the DOM, and Enter is dispatched to it as a keydown.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { shot } from "../support/shot.ts";

const NAME = "2026-10-26-l09-find.md";

// A synthetic lecture as Lecter writes it (03-lecture-files.md). English only.
const LECTURE = [
  "---",
  "lecter: 1",
  "lecture: 9",
  "date: 2026-10-26",
  "title: Covariance and Correlation",
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

/** The course's search index: a cache other flows' lectures may be in. */
const indexDir = () => join(course(), ".lecter", "cache", "index");

/** The `data-lecture#data-block` of each hit in the side panel, in order, read in one call. */
function hits(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(
      document.querySelectorAll(".find-hit"),
      (e) => `${e.getAttribute("data-lecture")}#${e.getAttribute("data-block")}`,
    ),
  );
}

/** Waits until the hits are exactly `expected`, in order. */
async function expectHits(expected: string[]): Promise<void> {
  const want = JSON.stringify(expected);
  await browser
    .waitUntil(async () => JSON.stringify(await hits()) === want, { timeoutMsg: `the hits never read ${want}` })
    .catch(() => undefined);
  expect(await hits()).toEqual(expected);
}

/** Sets `value` in `input` as typing would, then dispatches Enter (with keyCode 13) to it. */
function enter(selector: string, value: string): Promise<boolean> {
  return browser.execute(
    (s: string, v: string) => {
      const input = document.querySelector(s) as HTMLInputElement | null;
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

describe(":find", function () {
  // The service's window-focus check adds up to ~10 s of waits before every find and click.
  this.timeout(300_000);

  before(() => {
    mkdirSync(join(course(), "lectures"), { recursive: true });
    writeFileSync(join(course(), "lectures", NAME), LECTURE);
    // Only this flow's lecture is in the index; the app opens it on the first lecture_open.
    rmSync(indexDir(), { recursive: true, force: true });
  });

  // Other flows list this course's lectures exactly.
  after(() => {
    rmSync(join(course(), "lectures", NAME), { force: true });
    rmSync(indexDir(), { recursive: true, force: true });
  });

  it("lists the ranked hits of :find words in the side panel", async () => {
    await $("button.rail-add").click();
    await $(`button.course-file-open[data-path="lectures/${NAME}"]`).click();
    await expect($(".lecture-buffer")).toHaveAttribute("data-lecture", `lectures/${NAME}`);
    await expect($(".lecture-buffer")).toHaveAttribute("data-vim-mode", "normal");

    await browser.keys(":");
    await expect($(".cmdline-input")).toBeExisting();
    expect(await enter(".cmdline-input", "find variables")).toBe(true);

    // Both blocks say "variables" once; BM25 ranks the shorter one first.
    await expectHits([`lectures/${NAME}#s1b2`, `lectures/${NAME}#s1b1`]);
    await expect($(".find-status")).toHaveText("2 hits for “variables”");
    await expect($(".find-hit-text")).toHaveText("It is zero for independent variables.");
    expect(existsSync(join(indexDir(), "meta.json"))).toBe(true);
    await shot("find");
  });

  it("searches with the Find field and button too", async () => {
    await browser.execute(() => {
      const field = document.querySelector(".find-input") as HTMLInputElement | null;
      if (field) field.value = "bilinear";
    });
    await $("button.find-submit").click();
    await expectHits([`lectures/${NAME}#s2b1`]);
    expect(await enter(".find-input", "eigenvalue")).toBe(true);
    await expect($(".find-status")).toHaveText("No hits for “eigenvalue”");
    await expectHits([]);
  });
});
