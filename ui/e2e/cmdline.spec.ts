import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { defaultFixture, expect, test, trustScreen } from "./mock-core";
import { sampleLecture } from "./mock-core/lectures";

// F-040 (10-keymap.md#commands, 12-settings-theme-onboarding.md#settings and #performance-preset):
// `:` in the lecture opens the command line, which completes commands and setting keys; `:set
// key=value` is checked against the settings schema and refused with the reason; `:set key?` shows
// the value and its level; `:set ui.performance=quality` applies at once with its note. Against the
// mocked core, serving the schema the core generates.

const lecturePath = "lectures/2026-10-23-l07-covariance.md";
const schema = readFileSync(new URL("../../crates/core/src/settings/settings.schema.json", import.meta.url), "utf8");

test.use({
  mockCore: {
    ...defaultFixture,
    courseOpen: {
      path: "/courses/STAT311",
      name: "STAT311",
      lectures: [{ name: "2026-10-23-l07-covariance.md", path: lecturePath }],
      slides: [],
      sources: [],
      trust: "trusted",
      screen: trustScreen,
    },
    lectures: { [lecturePath]: { path: lecturePath, name: "2026-10-23-l07-covariance.md", text: sampleLecture } },
    settings: {
      schema,
      values: {
        "ui.performance": { value: '"balanced"', source: "default" },
        "index.contextLines": { value: "false", source: "default" },
      },
    },
  },
});

async function openLecture(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Add a course" }).click();
  await page.getByRole("button", { name: "2026-10-23-l07-covariance.md" }).click();
  await expect(page.locator(".lecture-buffer")).toHaveAttribute("data-vim-mode", "normal");
}

/** Saves a screenshot as evidence when LECTER_EVIDENCE_DIR is set. */
async function evidence(page: Page, name: string): Promise<void> {
  if (process.env.LECTER_EVIDENCE_DIR)
    await page.screenshot({ path: `${process.env.LECTER_EVIDENCE_DIR}/${name}.png` });
}

test(":set completes, checks, shows and applies settings from the command line @smoke", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openLecture(page);
  const box = page.getByRole("dialog", { name: "Command line" });
  const line = box.getByRole("combobox", { name: "Command" });
  const options = box.getByRole("option");
  const status = page.locator(".cmdline-message");

  // Criterion 1: `:` opens it, with completion for commands…
  await page.keyboard.press(":");
  await expect(box).toBeVisible();
  await expect(line).toBeFocused();
  await expect(box.locator(".cmdline-notch")).toHaveText("Cmdline");
  await expect(options.locator(".cmdline-completion-label")).toHaveText(["find", "read", "set"]);
  await page.keyboard.type("se");
  await page.keyboard.press("Tab");
  await expect(line).toHaveValue("set ");
  // …and for setting keys.
  await page.keyboard.type("ui.p");
  await expect(options.locator(".cmdline-completion-label")).toHaveText(["ui.performance"]);
  await page.keyboard.press("Tab");
  await expect(line).toHaveValue("set ui.performance");

  // Criterion 3: `:set key?` shows the value and its level.
  await page.keyboard.type("?");
  await page.keyboard.press("Enter");
  await expect(box).toBeHidden();
  await expect(status.locator(".cmdline-message-line")).toHaveText("ui.performance=balanced (default)");
  await expect(page.locator(".lecture-buffer")).toHaveAttribute("data-vim-mode", "normal");

  // Criteria 2 and 4: a value outside the schema is refused with the three allowed values.
  await page.keyboard.press(":");
  await page.keyboard.type("set ui.performance=fast");
  await page.keyboard.press("Enter");
  await expect(box.getByRole("alert")).toHaveText("ui.performance must be one of performance, balanced, quality");
  await expect(box).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __mockSettings?: unknown[] }).__mockSettings)).toBe(
    undefined,
  );

  // Values complete too; the mouse takes one.
  await line.fill("set ui.performance=");
  await expect(options.locator(".cmdline-completion-label")).toHaveText(["performance", "balanced", "quality"]);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(options.nth(2)).toHaveAttribute("aria-selected", "true");
  await evidence(page, "cmdline");
  await options.nth(2).click();
  await expect(line).toHaveValue("set ui.performance=quality");
  await expect(line).toBeFocused();

  // Criterion 4: quality applies at once, with its note; no restart.
  await page.keyboard.press("Enter");
  await expect(status.locator(".cmdline-message-line")).toHaveText("ui.performance=quality (global)");
  await expect(status.locator(".cmdline-message-note")).toHaveText("Can add input lag on slower machines.");
  await evidence(page, "cmdline-quality");
  expect(await page.evaluate(() => (window as unknown as { __mockSettings?: unknown[] }).__mockSettings)).toEqual([
    { key: "ui.performance", value: '"quality"', course: "/courses/STAT311" },
  ]);
  await page.keyboard.press(":");
  await page.keyboard.type("set ui.performance?");
  await page.keyboard.press("Enter");
  await expect(status.locator(".cmdline-message-line")).toHaveText("ui.performance=quality (global)");

  // A true/false setting, and Esc closing the box back to the buffer.
  await page.keyboard.press(":");
  await page.keyboard.type("set index.contextLines=yes");
  await page.keyboard.press("Enter");
  await expect(box.getByRole("alert")).toHaveText("index.contextLines must be true or false");
  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();
  await expect(page.locator(".cm-content")).toBeFocused();
  await expect(page.locator(".lecture-buffer")).toHaveAttribute("data-vim-mode", "normal");
  expect(errors).toEqual([]);
});
