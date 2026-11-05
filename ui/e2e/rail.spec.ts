import { defaultFixture, expect, test, trustScreen } from "./mock-core";

// F-035: the course rail. One icon per course (its text on its colour), + to add one, drag or
// Shift-J/K to reorder (the order is saved in the core), Ctrl-1…9 to switch. Against the mocked
// core; the core's store and checks are tested in Rust and through lecter-harness, the real app
// in tests/e2e/flows/rail.ts.

const course = (path: string, name: string) => ({
  path,
  name,
  lectures: [{ name: "l01.md", path: "lectures/l01.md" }],
  slides: [],
  trust: "trusted" as const,
  screen: trustScreen,
});
const stat = course("/courses/STAT311", "Probability and Statistics");
const calc = course("/courses/MATH221", "Calculus II");
const phys = course("/courses/PHYS101", "Physics");

test.use({
  mockCore: {
    ...defaultFixture,
    rail: [
      { path: stat.path, name: stat.name, icon: "S", color: "#3584e4", missing: false },
      { path: calc.path, name: calc.name, icon: "C", color: "#26a269", missing: false },
    ],
    switch: { [stat.path]: stat, [calc.path]: calc },
    courseOpen: phys,
  },
});

const rows = (page: import("@playwright/test").Page) => page.getByRole("list", { name: "Courses" }).getByRole("button");

test("shows one icon per course; + adds one; drag reorders; Ctrl-1/2 switch @smoke", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(rows(page)).toHaveCount(2);
  const icons = page.locator(".rail-course .rail-icon");
  await expect(icons).toHaveText(["S", "C"]);
  // Each icon sits on its course's colour.
  const colours = await icons.evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  expect(colours).toEqual(["rgb(53, 132, 228)", "rgb(38, 162, 105)"]);

  // + opens the folder dialog; the picked course joins the end of the rail.
  await page.getByRole("button", { name: "Add a course" }).click();
  await expect(page.getByRole("region", { name: "Course Physics" })).toBeVisible();
  await expect(icons).toHaveText(["S", "C", "P"]);
  await expect(rows(page).nth(2)).toHaveAttribute("aria-current", "true");

  // Drag Physics above Probability and Statistics.
  const from = await rows(page).nth(2).boundingBox();
  const to = await rows(page).nth(0).boundingBox();
  if (!from || !to) throw new Error("no rail rows on screen");
  await page.mouse.move(from.x + 40, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, to.y + 4, { steps: 8 });
  await expect(page.locator(".rail-row[data-drop=before]")).toHaveCount(1);
  await page.mouse.up();
  await expect(icons).toHaveText(["P", "S", "C"]);
  // Saved in the core: a fresh read of the rail has the new order.
  const saved = await page.evaluate(async () => {
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string) => Promise<{ path: string }[]> } };
    return (await w.__TAURI_INTERNALS__.invoke("course_list")).map((c) => c.path);
  });
  expect(saved).toEqual(["/courses/PHYS101", "/courses/STAT311", "/courses/MATH221"]);

  await page.screenshot({ path: testInfo.outputPath("rail.png") });
  if (process.env.LECTER_EVIDENCE_DIR)
    await page.screenshot({ path: `${process.env.LECTER_EVIDENCE_DIR}/rail-mock.png` });

  // Ctrl-2 and Ctrl-3 (Cmd on macOS) switch by the order on screen, from anywhere. The rail goes
  // by the platform, not the user agent: Desktop Safari's is a Mac one even on Linux.
  const mod = await page.evaluate(() => (/Mac/.test(navigator.platform) ? "Meta" : "Control"));
  await expect(rows(page).nth(0)).toHaveAttribute("aria-keyshortcuts", `${mod}+1`);
  await page.keyboard.press(`${mod}+2`);
  await expect(page.getByRole("region", { name: "Course Probability and Statistics" })).toBeVisible();
  await page.keyboard.press(`${mod}+3`);
  await expect(page.getByRole("region", { name: "Course Calculus II" })).toBeVisible();
  await expect(rows(page).nth(2)).toHaveAttribute("aria-current", "true");
});

test("Shift-J and Shift-K reorder from the keyboard; Enter opens", async ({ page }) => {
  await page.goto("/");
  await expect(rows(page)).toHaveCount(2);
  await rows(page).nth(0).focus();
  await page.keyboard.press("Shift+J");
  await expect(page.locator(".rail-course .rail-icon")).toHaveText(["C", "S"]);
  await expect(rows(page).nth(1)).toBeFocused();
  await page.keyboard.press("k");
  await expect(rows(page).nth(0)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Course Calculus II" })).toBeVisible();
  await rows(page).nth(1).focus();
  await page.keyboard.press("Shift+K");
  await expect(page.locator(".rail-course .rail-icon")).toHaveText(["S", "C"]);
});

test.describe("a course whose folder is gone", () => {
  test.use({
    mockCore: {
      ...defaultFixture,
      rail: [{ path: calc.path, name: calc.name, icon: "C", color: "#26a269", missing: true }],
      switch: {},
    },
  });

  test("shows as missing and says why it won't open", async ({ page }) => {
    await page.goto("/");
    const row = page.getByRole("button", { name: "Course Calculus II (folder missing)" });
    await expect(row).toHaveClass(/missing/);
    await row.click();
    await expect(page.getByRole("alert")).toHaveText(
      "That course folder is missing or has moved; add it again with +.",
    );
  });
});
