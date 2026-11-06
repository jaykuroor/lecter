// F-041: the command palette and quick switcher in the real app (09-ui.md#slack-and-discord-behaviours,
// 10-keymap.md#global-os-conventions). Ctrl/Cmd-Shift-P lists every command with its keys;
// Ctrl/Cmd-p jumps to a lecture typed by part of its name; Ctrl/Cmd-K opens neither.
//
// The embedded WebDriver sends keys as synthetic KeyboardEvents to the focused element; the flow
// dispatches the modified keys the same way in the page, and sets the field's text through the DOM.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { shot } from "../support/shot.ts";

const NAME = "2026-11-02-l11-palette.md";
const LECTURE = [
  "---",
  "lecter: 1",
  "lecture: 11",
  "date: 2026-11-02",
  "title: Moment generating functions",
  "---",
  "",
  '::: {.slide #s1 n=1 src="A1" title="Moments"}',
  "## Moments",
  "",
  "[The moment generating function encodes every moment.]{#s1b1}",
  "",
  ":::",
  "",
].join("\n");

function course(): string {
  const dir = process.env.LECTER_TEST_PICK;
  if (!dir) throw new Error("LECTER_TEST_PICK is not set: run flows through scripts/e2e-app.sh");
  return dir;
}

/** A keydown on the focused element, with Ctrl (Cmd on macOS) and maybe Shift held. */
function chord(key: string, shift: boolean): Promise<void> {
  return browser.execute(
    (k: string, s: boolean) => {
      const mac = navigator.platform.startsWith("Mac");
      const target = document.activeElement ?? document.body;
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: s ? k.toUpperCase() : k,
          code: `Key${k.toUpperCase()}`,
          ctrlKey: !mac,
          metaKey: mac,
          shiftKey: s,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    key,
    shift,
  );
}

/** The open dialog's name, or null. */
const dialog = (): Promise<string | null> =>
  browser.execute(() => document.querySelector('[role="dialog"].palette')?.getAttribute("aria-label") ?? null);

/** Types `text` into the palette's field as typing would, then presses `key` there. */
function typeThen(text: string, key: string): Promise<void> {
  return browser.execute(
    (t: string, k: string) => {
      const input = document.querySelector(".palette-input") as HTMLInputElement | null;
      if (!input) return;
      input.value = t;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    },
    text,
    key,
  );
}

describe("palette", function () {
  this.timeout(300_000);

  before(() => {
    mkdirSync(join(course(), "lectures"), { recursive: true });
    writeFileSync(join(course(), "lectures", NAME), LECTURE);
  });

  // Other flows list this course's lectures exactly.
  after(() => rmSync(join(course(), "lectures", NAME), { force: true }));

  it("lists every command with its keys on Ctrl-Shift-P", async () => {
    await $("button.rail-add").click();
    await expect($(`button.course-file-open[data-path="lectures/${NAME}"]`)).toBeDisplayed();
    // The engine and the palette are in once the headerbar's Go to button is enabled.
    await expect($('button[aria-label="Go to"]')).toBeEnabled();
    await chord("p", true);
    await browser.waitUntil(async () => (await dialog()) === "Command palette", { timeoutMsg: "no palette" });
    const keys = await browser.execute(() => {
      const rows = [...document.querySelectorAll(".palette-row")];
      const row = rows.find((r) => r.querySelector(".palette-label")?.textContent === "Quick switcher");
      return { count: rows.length, keys: [...(row?.querySelectorAll("kbd") ?? [])].map((k) => k.textContent) };
    });
    expect(keys.count).toBeGreaterThan(80);
    expect(keys.keys).toEqual([process.platform === "darwin" ? "⌘p" : "Ctrl-p"]);
    await shot("palette-app");
    await typeThen("", "Escape");
    await browser.waitUntil(async () => (await dialog()) === null, { timeoutMsg: "the palette stayed open" });
  });

  it("jumps to a lecture typed by part of its name on Ctrl-p, and Ctrl-K opens nothing", async () => {
    await chord("k", false);
    expect(await dialog()).toBeNull();
    await chord("p", false);
    await browser.waitUntil(async () => (await dialog()) === "Quick switcher", { timeoutMsg: "no switcher" });
    await typeThen("l11", "Enter");
    await expect($(".lecture-buffer")).toHaveAttribute("data-lecture", `lectures/${NAME}`);
    expect(await dialog()).toBeNull();
  });
});
