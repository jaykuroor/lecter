import { defaultFixture, expect, test, trustScreen } from "./mock-core";
import { sampleLecture } from "./mock-core/lectures";

// F-036: the sidebar (09-ui.md#layout) lists Dashboard, Lectures, Lists and Sources; j/k, the
// arrow keys and Enter go through it; ␣e (10-keymap.md#leader-groups) or the headerbar button
// shows and hides it. Against the mocked core.

const l07 = "lectures/2026-10-23-l07-covariance.md";
const l08 = "lectures/2026-10-30-l08-correlation.md";

test.use({
  mockCore: {
    ...defaultFixture,
    courseOpen: {
      path: "/courses/STAT311",
      name: "STAT311",
      lectures: [
        // The core reads each lecture's front-matter date (D-194); l08's file has none.
        { name: "2026-10-23-l07-covariance.md", path: l07, date: "2026-10-23" },
        { name: "2026-10-30-l08-correlation.md", path: l08, date: null },
      ],
      slides: [{ name: "07-covariance.pdf", path: "slides/07-covariance.pdf" }],
      sources: [{ name: "textbook.pdf", path: "sources/textbook.pdf" }],
      trust: "trusted",
      screen: trustScreen,
    },
    lectures: {
      [l07]: { path: l07, name: "2026-10-23-l07-covariance.md", text: sampleLecture },
      [l08]: { path: l08, name: "2026-10-30-l08-correlation.md", text: sampleLecture },
    },
  },
});

test("the sidebar lists the course, moves with j/k and the arrows, opens with Enter and toggles with ␣e @smoke", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Add a course" }).click();

  const sidebar = page.getByRole("region", { name: "Course STAT311" });
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole("region")).toHaveCount(5);
  await expect(sidebar.locator(".sidebar-row .sidebar-name")).toHaveText([
    "Dashboard",
    "2026-10-23-l07-covariance.md",
    "2026-10-30-l08-correlation.md",
    "Doubts",
    "Flags",
    "Office hours",
    "Later",
    "Revise",
    "07-covariance.pdf",
    "textbook.pdf",
  ]);
  await expect(sidebar.locator(`[data-path="${l07}"] time`)).toHaveText("Oct 23");
  await expect(sidebar.locator(`[data-path="${l08}"] time`)).toHaveCount(0);
  await expect(sidebar.getByRole("region", { name: "Readings" }).getByRole("listitem")).toHaveText(["textbook.pdf"]);

  // Keys: from Dashboard, j and ↓ go down, k and ↑ up, End and Home to the ends.
  const focused = () => page.evaluate(() => document.activeElement?.querySelector(".sidebar-name")?.textContent ?? "");
  await sidebar.getByRole("button", { name: "Dashboard" }).focus();
  await page.keyboard.press("j");
  expect(await focused()).toBe("2026-10-23-l07-covariance.md");
  await page.keyboard.press("ArrowDown");
  expect(await focused()).toBe("2026-10-30-l08-correlation.md");
  await page.keyboard.press("j");
  expect(await focused()).toBe("Doubts");
  await page.keyboard.press("k");
  await page.keyboard.press("ArrowUp");
  expect(await focused()).toBe("2026-10-23-l07-covariance.md");
  await page.keyboard.press("End");
  expect(await focused()).toBe("textbook.pdf");
  await page.keyboard.press("Home");
  expect(await focused()).toBe("Dashboard");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const buffer = page.locator(".lecture-buffer");
  await expect(buffer).toHaveAttribute("data-lecture", l08);
  await expect(sidebar.getByRole("button", { name: "2026-10-30-l08-correlation.md" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.screenshot({ path: testInfo.outputPath("sidebar.png") });
  if (process.env.LECTER_EVIDENCE_DIR)
    await page.screenshot({ path: `${process.env.LECTER_EVIDENCE_DIR}/sidebar.png` });

  // ␣e from the buffer in normal mode hides the sidebar and shows it again; the buffer's cursor
  // doesn't move (Space isn't Vim's "right" here).
  await page.locator(".cm-focused-line").click();
  await expect(buffer).toHaveAttribute("data-vim-mode", "normal");
  const line = await page.locator(".cm-focused-line").textContent();
  const toggle = page.getByRole("button", { name: "Sidebar" });
  await page.keyboard.press(" ");
  await page.keyboard.press("e");
  await expect(sidebar).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press(" ");
  await page.keyboard.press("e");
  await expect(sidebar).toBeVisible();
  await expect(page.locator(".cm-focused-line")).toHaveText(line ?? "");

  // In insert mode Space and e are text.
  await page.keyboard.press("i");
  await expect(buffer).toHaveAttribute("data-vim-mode", "insert");
  await page.keyboard.type(" e");
  await page.keyboard.press("Escape");
  await expect(sidebar).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText(" e");

  // The mouse: the headerbar button.
  await toggle.click();
  await expect(sidebar).toBeHidden();
  await toggle.click();
  await expect(sidebar).toBeVisible();
  // Each toggle was saved for the next start (D-195).
  const saved = await page.evaluate(() => (window as unknown as { __mockLayout?: unknown[] }).__mockLayout);
  expect(saved).toEqual([{ sidebar: false }, { sidebar: true }, { sidebar: false }, { sidebar: true }]);
  expect(errors).toEqual([]);
});

test.describe("after a run that hid the sidebar", () => {
  test.use({ mockCore: { ...defaultFixture, layout: { sidebar: false } } });

  test("the app starts with it hidden, and ␣e brings it back", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Sidebar" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#sidebar")).toBeHidden();
    await page.keyboard.press(" ");
    await page.keyboard.press("e");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});
