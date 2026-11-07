import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { readSchema, type SettingSpec } from "../src/features/cmdline/schema";
import { defaultFixture, expect, test, trustScreen } from "./mock-core";

// F-045 (12-settings-theme-onboarding.md#settings and #performance-preset): Ctrl/Cmd-, or the
// headerbar's button opens Settings; its pages render controls from the schema the core generates,
// with search; a change is written to the global file or the open course's own and applies at
// once; every control is reachable by key (Tab, arrows, j/k, / filter); Performance offers the
// three presets with Balanced picked on a new install, and Quality notes its lag. Against the
// mocked core.

const schema = readFileSync(new URL("../../crates/core/src/settings/settings.schema.json", import.meta.url), "utf8");
const LAG = "Can add input lag on slower machines.";

/** A plain value of a setting's type, for the settings this flow doesn't look at. */
const plain = (s: SettingSpec): string =>
  s.kind === "choice"
    ? JSON.stringify(s.choices[0])
    : s.kind === "boolean"
      ? "false"
      : s.kind === "list"
        ? "[]"
        : s.kind === "text"
          ? "null"
          : "0";

/** A new install's values: the built-in defaults of the settings this flow looks at. */
const values = {
  ...Object.fromEntries(readSchema(schema).map((s) => [s.key, { value: plain(s), source: "default" as const }])),
  "ui.performance": { value: '"balanced"', source: "default" as const },
  "ui.hintBar": { value: '"full"', source: "default" as const },
  "ui.keystrokes": { value: "true", source: "default" as const },
  "ui.theme": { value: "null", source: "default" as const },
  "ai.webSearch": { value: '"provider"', source: "default" as const },
  "ai.hedgeAfterMs": { value: "1500", source: "default" as const },
  "privacy.shareFeedback": { value: "false", source: "default" as const },
};

test.use({
  mockCore: {
    ...defaultFixture,
    courseOpen: {
      path: "/courses/STAT311",
      name: "STAT311",
      lectures: [],
      slides: [],
      sources: [],
      trust: "trusted",
      screen: trustScreen,
    },
    settings: { schema, values },
    theme: {
      update: defaultFixture.theme.update,
      installed: [
        { name: "Adwaita", folder: "/usr/share/themes/Adwaita" },
        { name: "Nord", folder: "" },
      ],
    },
  },
});

const isMac = (page: Page) => page.evaluate(() => navigator.platform.startsWith("Mac"));

async function start(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("banner").getByRole("button", { name: "Settings" })).toBeEnabled();
}

/** Saves a screenshot as evidence when LECTER_EVIDENCE_DIR is set. */
async function evidence(page: Page, name: string): Promise<void> {
  if (process.env.LECTER_EVIDENCE_DIR)
    await page.screenshot({ path: `${process.env.LECTER_EVIDENCE_DIR}/${name}.png` });
}

const writes = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mockSettings?: unknown[] }).__mockSettings ?? []);

test("Ctrl-, opens Settings with every page, searchable, and a change applies at once @smoke", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  const mod = (await isMac(page)) ? "Meta" : "Control";
  await page.keyboard.press(`${mod}+Comma`);
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("searchbox", { name: "Search settings" })).toBeFocused();

  // Criterion 1: the pages, and Appearance's controls from the schema.
  await expect(dialog.getByRole("tab")).toHaveText([
    "Appearance",
    "Keys",
    "AI",
    "Providers",
    "Courses",
    "Notes and files",
    "Performance",
    "Privacy",
    "Advanced",
  ]);
  const hint = dialog.getByRole("radiogroup", { name: "Hint bar" });
  await expect(hint.getByRole("radio", { name: "Full" })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Keystrokes" })).toBeChecked();
  await expect(dialog.getByRole("combobox", { name: "Theme" }).locator("option")).toHaveText([
    "Follow the desktop",
    "Adwaita",
    "Nord",
  ]);
  await evidence(page, "settings");

  // Search across the pages.
  await page.keyboard.type("budget daily");
  await expect(dialog.locator(".settings-row")).toHaveCount(1);
  await expect(dialog.locator(".settings-row .settings-key")).toHaveText("ai.budget.daily");
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("searchbox")).toHaveValue("");

  // Criterion 2: a change writes the global file and applies at once: the hint bar goes compact.
  await expect(page.locator(".hint-bar")).toHaveAttribute("data-detail", "full");
  await hint.getByRole("radio", { name: "Compact" }).click();
  await expect(page.locator(".hint-bar")).toHaveAttribute("data-detail", "compact");
  await expect(dialog.locator('[data-key="ui.hintBar"] .settings-source')).toHaveText("global");
  expect(await writes(page)).toEqual([{ key: "ui.hintBar", value: '"compact"', course: null, scope: "global" }]);

  // Esc closes it.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});

test("every control is reachable by key: Tab, arrows, j/k and / (criterion 3)", async ({ page }) => {
  await start(page);
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const search = dialog.getByRole("searchbox", { name: "Search settings" });
  await expect(search).toBeFocused();
  // Tab: the search, the file choice, the close button, the page list, then the settings.
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("radio", { name: "Global" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close settings" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("tab", { name: "Appearance" })).toBeFocused();
  // Arrows and j/k pick the page.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect(dialog.getByRole("tab", { name: "Providers" })).toBeFocused();
  await expect(dialog.getByRole("tab", { name: "Providers" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("k");
  await expect(dialog.getByRole("tab", { name: "AI" })).toBeFocused();
  // Tab goes into the page; j/k go from setting to setting; arrows change a choice.
  await page.keyboard.press("Tab");
  await expect(dialog.locator('[data-key="ai.budget.daily"] input')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.keyboard.press(`${(await isMac(page)) ? "Meta" : "Control"}+Comma`);
  await expect(search).toBeFocused();
  // It opens again on the page it was on; Home picks the first, and `/` goes back to the search.
  await expect(dialog.getByRole("tab", { name: "AI" })).toHaveAttribute("aria-selected", "true");
  await dialog.getByRole("tab", { name: "AI" }).focus();
  await page.keyboard.press("Home");
  await expect(dialog.getByRole("tab", { name: "Appearance" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(dialog.getByRole("radio", { name: "Full" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("radio", { name: "Compact" })).toBeChecked();
  await expect(page.locator(".hint-bar")).toHaveAttribute("data-detail", "compact");
  await page.keyboard.press("j");
  const keystrokes = dialog.getByRole("checkbox", { name: "Keystrokes" });
  await expect(keystrokes).toBeFocused();
  await page.keyboard.press("Space");
  await expect(keystrokes).not.toBeChecked();
  await page.keyboard.press("k");
  await expect(dialog.getByRole("radio", { name: "Compact" })).toBeFocused();
  // `/` goes to the search from anywhere but a text field.
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
  await page.keyboard.type("hedge after");
  await page.keyboard.press("Enter");
  const hedge = dialog.getByRole("textbox", { name: "Hedge after ms" });
  await expect(hedge).toBeFocused();
  await hedge.fill("900");
  await page.keyboard.press("Enter");
  await expect(dialog.locator('[data-key="ai.hedgeAfterMs"] .settings-source')).toHaveText("global");
  // Shift-Tab from the search goes round to the last setting; Tab from there back to the search.
  await search.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(hedge).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(search).toBeFocused();
  expect((await writes(page)).map((w) => (w as { key: string }).key)).toEqual([
    "ui.hintBar",
    "ui.keystrokes",
    "ai.hedgeAfterMs",
  ]);
});

test("Performance offers three presets, Balanced on a new install, and notes Quality's lag (criterion 4)", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("tab", { name: "Performance" }).click();
  const group = dialog.getByRole("radiogroup", { name: "Performance" });
  await expect(group.locator(".settings-preset-title")).toHaveText(["Performance", "Balanced", "Quality"]);
  await expect(group.getByRole("radio", { name: /^Balanced/ })).toBeChecked();
  await expect(dialog.getByText(LAG)).toHaveCount(0);
  await group.getByRole("radio", { name: /^Quality/ }).click();
  await expect(dialog.getByRole("note")).toHaveText(LAG);
  await evidence(page, "settings-performance-quality");
  expect(await writes(page)).toEqual([{ key: "ui.performance", value: '"quality"', course: null, scope: "global" }]);
  await group.getByRole("radio", { name: /^Balanced/ }).click();
  await expect(dialog.getByText(LAG)).toHaveCount(0);
});

test("This course writes the open course's own settings, never a global-only one (criterion 2)", async ({ page }) => {
  await start(page);
  await page.getByRole("button", { name: "Add a course" }).click();
  await expect(page.getByRole("region", { name: "Course STAT311" })).toBeVisible();
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("radio", { name: "This course (STAT311)" }).check();
  await dialog.getByRole("radiogroup", { name: "Hint bar" }).getByRole("radio", { name: "Off" }).click();
  await expect(page.locator(".hint-bar")).toHaveCount(0);
  await expect(dialog.locator('[data-key="ui.hintBar"] .settings-source')).toHaveText("this course");
  await dialog.getByRole("tab", { name: "Privacy" }).click();
  await expect(dialog.getByRole("checkbox", { name: "Share feedback", exact: true })).toBeDisabled();
  await expect(dialog.locator('[data-key="privacy.shareFeedback"] .settings-note')).toHaveText(
    "Only the global settings can set this.",
  );
  expect(await writes(page)).toEqual([
    { key: "ui.hintBar", value: '"off"', course: "/courses/STAT311", scope: "course" },
  ]);
});
