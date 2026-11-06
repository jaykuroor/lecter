import type { Page } from "@playwright/test";
import { commandEntries } from "../src/features/palette/entries";
import { DEFAULT_KEYMAP } from "../src/keys/keymap";
import { defaultFixture, expect, test, trustScreen } from "./mock-core";
import { sampleLecture } from "./mock-core/lectures";

// F-041 (09-ui.md#slack-and-discord-behaviours, 10-keymap.md#global-os-conventions):
// Ctrl/Cmd-Shift-P lists every command with its key; Ctrl/Cmd-p fuzzy-jumps to courses,
// lectures, lists and sources; Ctrl/Cmd-K is not bound. The headerbar's buttons are the mouse
// way to both. Against the mocked core.

const l07 = "lectures/2026-10-23-l07-covariance.md";
const l08 = "lectures/2026-10-30-l08-correlation.md";

const stat = {
  path: "/courses/STAT311",
  name: "STAT311",
  lectures: [
    { name: "2026-10-23-l07-covariance.md", path: l07 },
    { name: "2026-10-30-l08-correlation.md", path: l08 },
  ],
  slides: [{ name: "07-covariance.pdf", path: "slides/07-covariance.pdf" }],
  sources: [{ name: "textbook.pdf", path: "sources/textbook.pdf" }],
  trust: "trusted" as const,
  screen: trustScreen,
};
const calc = { ...stat, path: "/courses/MATH221", name: "MATH221", lectures: [], slides: [], sources: [] };

test.use({
  mockCore: {
    ...defaultFixture,
    courseOpen: stat,
    rail: [{ path: calc.path, name: "Calculus II", icon: "C", color: "#26a269", missing: false }],
    switch: { [calc.path]: calc, [stat.path]: stat },
    lectures: {
      [l07]: { path: l07, name: "2026-10-23-l07-covariance.md", text: sampleLecture },
      [l08]: { path: l08, name: "2026-10-30-l08-correlation.md", text: sampleLecture },
    },
  },
});

/** Opens STAT311 and waits until the key engine and the palette are in. */
async function openCourse(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Add a course" }).click();
  await expect(page.getByRole("region", { name: "Course STAT311" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Go to" })).toBeEnabled();
}

/** Saves a screenshot as evidence when LECTER_EVIDENCE_DIR is set. */
async function evidence(page: Page, name: string): Promise<void> {
  if (process.env.LECTER_EVIDENCE_DIR)
    await page.screenshot({ path: `${process.env.LECTER_EVIDENCE_DIR}/${name}.png` });
}

test("Ctrl-Shift-P lists every command with its key and runs one @smoke", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openCourse(page);
  await page.keyboard.press("Control+Shift+P");
  const box = page.getByRole("dialog", { name: "Command palette" });
  await expect(box).toBeVisible();
  await expect(box.getByRole("combobox", { name: "Command" })).toBeFocused();
  // Every command of the keymap, each with its keys.
  const all = commandEntries(DEFAULT_KEYMAP, false);
  const rows = box.getByRole("option");
  await expect(rows).toHaveCount(all.length);
  const keysOf = (title: string) => rows.filter({ hasText: title }).first().locator("kbd");
  await expect(keysOf("Command palette")).toHaveText(["Ctrl-Shift-p"]);
  await expect(keysOf("Quick switcher")).toHaveText(["Ctrl-p"]);
  await expect(keysOf("Next slide")).toHaveText(["Ctrl-j", "]]"]);
  await expect(keysOf("Toggle sidebar")).toHaveText(["␣e"]);
  await evidence(page, "palette");

  // Typing filters; Enter runs the pick from where the focus was: ␣e hides the sidebar.
  await page.keyboard.type("tgl sidebar");
  await expect(rows.first()).toContainText("Toggle sidebar");
  await page.keyboard.press("Enter");
  await expect(box).toBeHidden();
  await expect(page.locator("#sidebar")).toBeHidden();

  // The headerbar's button opens it by mouse; a click on a row runs it.
  await page.getByRole("button", { name: "Commands" }).click();
  await box.getByRole("option").filter({ hasText: "Toggle sidebar" }).click();
  await expect(page.locator("#sidebar")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Ctrl-p jumps to a lecture, a course, a list and a source; Esc closes @smoke", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openCourse(page);
  await page.keyboard.press("Control+P");
  const box = page.getByRole("dialog", { name: "Quick switcher" });
  const rows = box.getByRole("option");
  await expect(box).toBeVisible();
  await expect(rows.locator(".palette-kind")).toHaveText([
    "Course",
    "Course",
    "Lecture",
    "Lecture",
    "List",
    "List",
    "List",
    "List",
    "List",
    "Source",
    "Source",
  ]);
  // Part of a lecture's name is enough.
  await page.keyboard.type("l07");
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator("mark")).toHaveText(["l07"]);
  await evidence(page, "switcher");
  await page.keyboard.press("Enter");
  await expect(box).toBeHidden();
  await expect(page.locator(".lecture-buffer")).toHaveAttribute("data-lecture", l07);

  // A list's view doesn't exist yet: the switcher shows its row in the sidebar.
  await page.keyboard.press("Control+P");
  await page.keyboard.type("office");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Office hours" })).toBeFocused();

  // A source: its row in the sidebar.
  await page.keyboard.press("Control+P");
  await page.keyboard.type("textbook");
  await page.keyboard.press("Enter");
  await expect(page.locator('#sidebar li[title="sources/textbook.pdf"]')).toBeFocused();

  // Esc closes and gives the focus back.
  await page.keyboard.press("Control+P");
  await expect(box).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();
  await expect(page.locator('#sidebar li[title="sources/textbook.pdf"]')).toBeFocused();

  // By mouse: the headerbar's Go to, then a click on a course.
  await page.getByRole("button", { name: "Go to" }).click();
  await rows.filter({ hasText: "Calculus II" }).click();
  await expect(page.getByRole("region", { name: "Course MATH221" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Ctrl-K is not bound: it opens neither the switcher nor the palette", async ({ page }) => {
  await openCourse(page);
  await page.locator("body").click({ position: { x: 640, y: 400 } });
  await page.keyboard.press("Control+K");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The switcher's own key still works from the same place.
  await page.keyboard.press("Control+P");
  await expect(page.getByRole("dialog", { name: "Quick switcher" })).toBeVisible();
});
