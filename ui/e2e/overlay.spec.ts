import type { Page } from "@playwright/test";
import { defaultFixture, expect, test, trustScreen } from "./mock-core";
import { sampleLecture } from "./mock-core/lectures";

// F-039 (09-ui.md#hint-bar-and-keystroke-overlay): the keystroke overlay shows the keys typed,
// including pending sequences, bottom right of the buffer, and fades after 1.5 s; ␣uk turns it
// off and on. Read mode (␣ur, :read, the headerbar's button) hides the rail, the sidebar, the hint
// bar and the overlay, and shows them again. Against the mocked core.

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

/** Opens the sample lecture; the cursor is on its first slide line. */
async function openLecture(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Add a course" }).click();
  await page.getByRole("button", { name: "2026-10-23-l07-covariance.md" }).click();
  await expect(page.locator(".lecture-buffer")).toHaveAttribute("data-vim-mode", "normal");
  await expect(page.getByRole("region", { name: "Keys that work now" })).toBeVisible();
}

/** Saves a screenshot as evidence when LECTER_EVIDENCE_DIR is set. */
async function evidence(page: Page, name: string): Promise<void> {
  if (process.env.LECTER_EVIDENCE_DIR)
    await page.screenshot({ path: `${process.env.LECTER_EVIDENCE_DIR}/${name}.png` });
}

/** Waits until the page has drawn two more frames (the overlay draws in the next one). */
async function twoFrames(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

async function keys(page: Page, ...list: string[]): Promise<void> {
  for (const key of list) await page.keyboard.press(key);
}

test("the overlay shows typed keys and pending sequences, bottom right of the buffer, and fades after 1.5 s @smoke", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openLecture(page);
  const overlay = page.locator(".keystroke-overlay");
  const caps = overlay.locator("kbd");

  await keys(page, "j", "k", "3");
  await expect(caps).toHaveText(["j", "k", "3"]);
  // The count waits for its motion: the engine holds it.
  await expect(overlay.locator(".keystroke-pending")).toHaveText(["3"]);
  const box = await overlay.boundingBox();
  const buffer = await page.locator("main.buffer").boundingBox();
  if (!box || !buffer) throw new Error("no overlay or buffer box");
  expect(Math.round(buffer.x + buffer.width - (box.x + box.width))).toBe(14);
  expect(Math.round(buffer.y + buffer.height - (box.y + box.height))).toBe(14);
  await evidence(page, "keystroke-overlay");

  await keys(page, "Escape", "Space", "u");
  await expect(caps).toHaveText(["j", "k", "3", "Esc", "␣", "u"]);
  await expect(overlay.locator(".keystroke-pending")).toHaveText(["␣", "u"]);
  await page.keyboard.press("Escape");
  await expect(overlay.locator(".keystroke-pending")).toHaveCount(0);

  // 1.5 s after the last key it fades, then it is gone.
  const last = Date.now();
  await page.keyboard.press("l");
  await expect(caps.last()).toHaveText("l");
  await expect(overlay).toBeHidden({ timeout: 5000 });
  expect(Date.now() - last).toBeGreaterThanOrEqual(1500);
  expect(errors).toEqual([]);
});

test("␣uk turns the overlay off and on", async ({ page }) => {
  await openLecture(page);
  const overlay = page.locator(".keystroke-overlay");
  await keys(page, "Space", "u", "k");
  await expect(overlay).toBeHidden();
  await page.keyboard.press("j");
  await twoFrames(page);
  await expect(overlay).toBeHidden();
  await keys(page, "Space", "u", "k");
  await expect(overlay.locator("kbd")).toHaveText(["␣", "u", "k"]);
});

test("read mode hides the rail, sidebar, hint bar and overlay; ␣ur, :read and the button go in and out", async ({
  page,
}) => {
  await openLecture(page);
  const rail = page.getByRole("navigation", { name: "Course rail" });
  const sidebar = page.locator("#sidebar");
  const hintBar = page.getByRole("region", { name: "Keys that work now" });
  const overlay = page.locator(".keystroke-overlay");
  const readButton = page.getByRole("banner").getByRole("button", { name: "Read mode" });
  await expect(sidebar).toBeVisible();
  const before = await page.locator("main.buffer").boundingBox();

  await keys(page, "Space", "u", "r");
  await expect(rail).toBeHidden();
  await expect(sidebar).toBeHidden();
  await expect(hintBar).toBeHidden();
  await expect(overlay).toBeHidden();
  await expect(readButton).toHaveAttribute("aria-pressed", "true");
  // The document takes the rail column's room, and the keys still go to the lecture.
  const wide = await page.locator("main.buffer").boundingBox();
  expect((wide?.width ?? 0) - (before?.width ?? 0)).toBe(208);
  await expect(page.locator(".cm-content")).toBeFocused();
  await page.keyboard.press("j");
  await twoFrames(page);
  await expect(overlay).toBeHidden();
  await evidence(page, "read-mode");

  // :read leaves it: everything is back as it was.
  await page.keyboard.press(":");
  await page.keyboard.type("read");
  await page.keyboard.press("Enter");
  await expect(rail).toBeVisible();
  await expect(sidebar).toBeVisible();
  await expect(hintBar).toBeVisible();
  await expect(readButton).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("k");
  await expect(overlay.locator("kbd").last()).toHaveText("k");

  // :read goes in too, and the headerbar's button out again; then the button in, ␣ur out.
  await page.keyboard.press(":");
  await page.keyboard.type("read");
  await page.keyboard.press("Enter");
  await expect(rail).toBeHidden();
  await readButton.click();
  await expect(rail).toBeVisible();
  await expect(hintBar).toBeVisible();
  await readButton.click();
  await expect(sidebar).toBeHidden();
  await page.locator(".cm-line").first().click();
  await keys(page, "Space", "u", "r");
  await expect(sidebar).toBeVisible();
  await expect(hintBar).toBeVisible();
});
