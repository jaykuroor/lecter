import { defaultFixture, expect, test, trustScreen } from "./mock-core";
import { sampleLecture } from "./mock-core/lectures";

// F-037: the key engine (10-keymap.md). ␣ opens which-key with all groups after 300 ms
// (09-ui.md#hint-bar-and-keystroke-overlay); the buffer keeps only the Vim subset, so the
// given-up keys do nothing there. Against the mocked core.

const lecturePath = "lectures/2026-10-23-l07-covariance.md";

test.use({
  mockCore: {
    ...defaultFixture,
    courseOpen: {
      path: "/courses/STAT311",
      name: "STAT311",
      lectures: [{ name: "2026-10-23-l07-covariance.md", path: lecturePath }],
      slides: [{ name: "07-covariance.pdf", path: "slides/07-covariance.pdf" }],
      sources: [],
      trust: "trusted",
      screen: trustScreen,
    },
    lectures: { [lecturePath]: { path: lecturePath, name: "2026-10-23-l07-covariance.md", text: sampleLecture } },
  },
});

test("␣ opens which-key with every group after 300 ms, in the buffer @smoke", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Add a course" }).click();
  await page.getByRole("button", { name: "2026-10-23-l07-covariance.md" }).click();
  const buffer = page.locator(".lecture-buffer");
  await expect(buffer).toHaveAttribute("data-vim-mode", "normal");

  const whichKey = page.getByRole("dialog", { name: "Keys that can follow" });
  // ␣ then e at once: the sidebar toggles and which-key never shows.
  await page.keyboard.press(" ");
  await page.keyboard.press("e");
  await expect(page.locator("#sidebar")).toBeHidden();
  await page.keyboard.press(" ");
  await page.keyboard.press("e");
  await expect(page.locator("#sidebar")).toBeVisible();
  await expect(whichKey).toHaveCount(0);

  // ␣ alone: still nothing a moment later, then which-key lists every group.
  const pressed = await page.evaluate(() => performance.now());
  await page.keyboard.press(" ");
  await expect(whichKey).toBeVisible();
  const shown = await page.evaluate(() => performance.now());
  expect(shown - pressed).toBeGreaterThanOrEqual(300);
  const groups = whichKey.locator(".which-key-group .which-key-desc");
  await expect(groups).toHaveText(["+AI", "+Search", "+Lists", "+Files", "+UI", "+Quit"]);
  await expect(whichKey.locator(".which-key-item")).toHaveCount(11);
  await page.screenshot({ path: testInfo.outputPath("which-key.png") });
  if (process.env.LECTER_EVIDENCE_DIR)
    await page.screenshot({ path: `${process.env.LECTER_EVIDENCE_DIR}/which-key.png` });

  // A group's key lists that group at once; Esc closes it, and the cursor never moved.
  const line = await page.locator(".cm-focused-line").textContent();
  await page.keyboard.press("a");
  await expect(whichKey.locator(".which-key-desc")).toHaveText([
    "Gap finder",
    "Pick model",
    "Figure mode",
    "Course chat",
  ]);
  await page.keyboard.press("Escape");
  await expect(whichKey).toHaveCount(0);
  await expect(page.locator(".cm-focused-line")).toHaveText(line ?? "");
  expect(errors).toEqual([]);
});

test("the given-up Vim keys do nothing on an own note; kept ones still edit", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add a course" }).click();
  await page.getByRole("button", { name: "2026-10-23-l07-covariance.md" }).click();
  const note = page.locator(".cm-line", { hasText: "Try it with numbers." });
  await note.click();
  await expect(page.locator(".lecture-buffer")).toHaveAttribute("data-vim-mode", "normal");
  const content = page.locator(".cm-content");
  const before = await content.textContent();
  // s S (substitute), q (macros), t T, marks, =, Enter (line down), Tab, R, H M L, #.
  for (const key of ["s", "S", "q", "t", "T", "m", "'", "=", "R", "H", "M", "L", "#", "Enter", "Tab", "`"]) {
    await page.keyboard.press(key);
  }
  await expect(page.locator(".lecture-buffer")).toHaveAttribute("data-vim-mode", "normal");
  expect(await content.textContent()).toBe(before);
  await expect(page.locator(".cm-focused-line")).toHaveText("Try it with numbers.");
  await expect(content).toBeFocused();
  // x is kept: it deletes the character under the cursor.
  await page.keyboard.press("0");
  await page.keyboard.press("x");
  await expect(page.locator(".cm-focused-line")).toHaveText("ry it with numbers.");
});
