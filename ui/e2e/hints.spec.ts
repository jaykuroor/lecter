import type { Page } from "@playwright/test";
import { defaultFixture, expect, test, trustScreen } from "./mock-core";
import { sampleLecture } from "./mock-core/lectures";

// F-038: the hint bar (09-ui.md#hint-bar-and-keystroke-overlay) lists the keys that work for the
// cursor's element and the mode, and its detail follows ui.hintBar (␣uh steps through full,
// compact and off). Against the mocked core.

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
}

/** Saves a screenshot as evidence when LECTER_EVIDENCE_DIR is set. */
async function evidence(page: Page, name: string): Promise<void> {
  if (process.env.LECTER_EVIDENCE_DIR)
    await page.screenshot({ path: `${process.env.LECTER_EVIDENCE_DIR}/${name}.png` });
}

test("the hint bar changes between a slide line and a gloss, and with the mode @smoke", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openLecture(page);
  const bar = page.getByRole("region", { name: "Keys that work now" });
  const words = bar.locator(".hint-main .hint-desc");
  // On a slide line: the line's keys, with the mouse way next to each (full, the default).
  await expect(words.first()).toHaveText("Ask about this line");
  await expect(bar.locator(".hint-main .hint").nth(1)).toHaveText("sStepsright-click the line");
  await expect(bar.locator(".hint-tail .hint-desc")).toHaveText(["Next pane", "More"]);
  await evidence(page, "hint-bar-slide-line");

  // Onto the gloss by a click, then off and on again by key: the gloss's keys, none of the line's.
  await page.locator(".cm-line", { hasText: "how do we get the 2Cov term?" }).click();
  await expect(words.nth(1)).toHaveText("Regenerate");
  await expect(words).not.toContainText(["Steps"]);
  await evidence(page, "hint-bar-gloss");
  await page.keyboard.press("k");
  await expect(words.nth(1)).toHaveText("Steps");
  await page.keyboard.press("j");
  await expect(words.nth(1)).toHaveText("Regenerate");

  // Insert mode: only the keys that work while typing.
  await page.locator(".cm-line", { hasText: "Try it with numbers." }).click();
  await expect(words.nth(1)).toHaveText("Steps");
  await page.keyboard.press("i");
  await expect(page.locator(".lecture-buffer")).toHaveAttribute("data-vim-mode", "insert");
  await expect(words).toHaveText(["Course", "Previous pane"]);
  await expect(bar.locator(".hint-tail .hint-desc")).toHaveText(["Next pane"]);
  await page.keyboard.press("Escape");
  await expect(words.nth(1)).toHaveText("Steps");
  expect(errors).toEqual([]);
});

test("␣uh steps the hint bar through full, compact and off; a click on a hint is its key", async ({ page }) => {
  await openLecture(page);
  const bar = page.getByRole("region", { name: "Keys that work now" });
  await expect(bar).toHaveAttribute("data-detail", "full");
  await expect(bar.locator(".hint-mouse").first()).toHaveText("right-click the line");

  await page.keyboard.press(" ");
  await page.keyboard.press("u");
  await page.keyboard.press("h");
  await expect(bar).toHaveAttribute("data-detail", "compact");
  await expect(bar.locator(".hint-mouse")).toHaveCount(0);
  await expect(bar.locator(".hint-main .hint-desc").first()).toHaveText("Ask about this line");

  await page.keyboard.press(" ");
  await page.keyboard.press("u");
  await page.keyboard.press("h");
  await expect(bar).toHaveCount(0);

  await page.keyboard.press(" ");
  await page.keyboard.press("u");
  await page.keyboard.press("h");
  await expect(bar).toHaveAttribute("data-detail", "full");

  // ␣ More by mouse: which-key opens with every group, and the cursor stays in the buffer.
  await bar.locator(".hint-tail .hint", { hasText: "More" }).click();
  const whichKey = page.getByRole("dialog", { name: "Keys that can follow" });
  await expect(whichKey).toBeVisible();
  await expect(whichKey.locator(".which-key-group .which-key-desc")).toHaveText([
    "+AI",
    "+Search",
    "+Lists",
    "+Files",
    "+UI",
    "+Quit",
  ]);
  await page.keyboard.press("e");
  await expect(page.locator("#sidebar")).toBeHidden();
  await expect(page.locator(".cm-content")).toBeFocused();

  // A click on a hint does what its key does: `i` edits the line, as typing i would.
  await bar.locator("button.hint", { hasText: "Edit / fix the line" }).click();
  await expect(page.locator(".lecture-buffer")).toHaveAttribute("data-vim-mode", "insert");
  await expect(page.locator(".cm-content")).toBeFocused();
  // `s` gave up its Vim meaning and nothing handles it yet: its hint is text, not a button.
  await page.keyboard.press("Escape");
  await expect(bar.locator(".hint-main span.hint", { hasText: "Steps" })).toHaveCount(1);
});
