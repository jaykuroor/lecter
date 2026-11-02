import { defaultFixture, expect, test } from "./mock-core";
import { sampleLecture } from "./mock-core/lectures";

// F-020: a lecture opened from the rail shows in one CodeMirror buffer (slide headings and blocks,
// docs/design/components.md) and moves with Vim keys (10-keymap.md#move-everywhere), against the
// mocked core.

const lecturePath = "lectures/2026-10-23-l07-covariance.md";

test.use({
  mockCore: {
    ...defaultFixture,
    courseOpen: {
      path: "/courses/STAT311",
      name: "STAT311",
      lectures: [{ name: "2026-10-23-l07-covariance.md", path: lecturePath }],
      slides: [{ name: "07-covariance.pdf", path: "slides/07-covariance.pdf" }],
      trust: "trusted",
    },
    lectures: { [lecturePath]: { path: lecturePath, name: "2026-10-23-l07-covariance.md", text: sampleLecture } },
  },
});

test("a lecture opens into the buffer and moves with j k gg G, i and Esc @smoke", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: /open course folder/i }).click();
  await page.getByRole("button", { name: "2026-10-23-l07-covariance.md" }).click();

  const buffer = page.locator(".lecture-buffer");
  await expect(buffer).toHaveAttribute("data-lecture", lecturePath);
  await expect(page.locator(".slide-heading-label")).toHaveText(["Slide 1 / 3", "⚑ Slide 2 / 3", "Slide 3 / 3"]);
  await expect(page.locator(".slide-heading-title").first()).toHaveText("Covariance");
  await expect(page.locator(".slide-heading-source").first()).toHaveText("07-covariance.pdf · slide 1");
  // Blocks show their text only: no brackets, no attributes, no fences, no front matter.
  await expect(page.locator(".cm-block").first()).toHaveText("Covariance measures how two variables move together.");
  await expect(page.locator(".cm-content")).not.toContainText("{#s1b1}");
  await expect(page.locator(".cm-content")).not.toContainText(":::");
  await expect(page.locator(".cm-content")).not.toContainText("lecter: 1");

  const focused = page.locator(".cm-focused-line");
  await expect(focused).toHaveText("Covariance measures how two variables move together.");
  await expect(buffer).toHaveAttribute("data-vim-mode", "normal");
  await page.screenshot({ path: testInfo.outputPath("buffer.png") });

  await page.keyboard.press("j");
  await expect(focused).toHaveText("It is zero for independent variables.");
  await page.keyboard.press("j");
  await expect(focused).toHaveClass(/cm-block/);
  await expect(focused).toContainText("\\operatorname{Cov}(aX+b,cY+d)");
  await page.keyboard.press("k");
  await expect(focused).toHaveText("It is zero for independent variables.");
  await page.keyboard.press("G");
  await expect(focused).toHaveText("Roll two dice and compare the sums.");
  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await expect(focused).toHaveText("Covariance measures how two variables move together.");

  await page.keyboard.press("i");
  await expect(buffer).toHaveAttribute("data-vim-mode", "insert");
  await page.keyboard.type("Typed ");
  await expect(focused).toHaveText("Typed Covariance measures how two variables move together.");
  await page.keyboard.press("Escape");
  await expect(buffer).toHaveAttribute("data-vim-mode", "normal");
  // Back in normal mode, keys move again instead of typing.
  await page.keyboard.press("j");
  await expect(focused).toHaveText("It is zero for independent variables.");
  expect(errors).toEqual([]);
});

test("a lecture the core can't open shows its message", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /open course folder/i }).click();
  await page.evaluate(() => {
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string) => Promise<unknown> } };
    w.__TAURI_INTERNALS__.invoke = () =>
      Promise.reject({ code: "E_NOT_FOUND", message: "lectures/x.md no longer exists.", retryable: false });
  });
  await page.getByRole("button", { name: "2026-10-23-l07-covariance.md" }).click();
  await expect(page.getByRole("alert")).toHaveText("lectures/x.md no longer exists.");
});
