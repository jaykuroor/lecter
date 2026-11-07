import type { Page } from "@playwright/test";
import { defaultFixture, expect, test, trustScreen } from "./mock-core";
import { sampleLecture } from "./mock-core/lectures";

// F-046 (09-ui.md#layout, components.md#status-line): the status line shows mode, course/lecture,
// slide, active model, lecture cost and a job spinner; the mode segment takes its mode's colours
// (tokens.json mode-colors) for NORMAL, INSERT, VISUAL and COMMAND. Against the mocked core.

const lecturePath = "lectures/2026-10-23-l07-covariance.md";

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
    // Slow enough to see the spinner turn while the answer streams.
    gloss: { deltas: ["**Sample answer.** ", "This is ", "the mocked core."], deltaMs: 400 },
  },
});

async function openLecture(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Add a course" }).click();
  await page.getByRole("button", { name: "2026-10-23-l07-covariance.md" }).click();
  await expect(page.locator(".lecture-buffer")).toHaveAttribute("data-vim-mode", "normal");
}

/** Saves the status line (and the window) as evidence when LECTER_EVIDENCE_DIR is set. */
async function evidence(page: Page, name: string): Promise<void> {
  const dir = process.env.LECTER_EVIDENCE_DIR;
  if (!dir) return;
  await page.locator(".status-line").screenshot({ path: `${dir}/${name}.png` });
  await page.screenshot({ path: `${dir}/${name}-window.png` });
}

/** The computed colour of `token` (a theme custom property) on this page. */
async function tokenColour(page: Page, token: string): Promise<string> {
  return page.evaluate((t) => {
    const probe = document.createElement("div");
    probe.style.color = `var(${t})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, token);
}

test("the status line shows mode, course/lecture, slide, model and the job spinner @smoke", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openLecture(page);
  const line = page.getByRole("status", { name: "Status line" });
  const mode = line.locator(".status-mode");

  await expect(mode).toHaveText("NORMAL");
  await expect(line.locator(".status-place")).toHaveText("STAT311/l07");
  // The cursor starts on the first slide's first block.
  await expect(line.getByTitle("Slide 1 of 3")).toHaveText("1/3");
  // No answer has streamed yet: no model named, nothing running.
  await expect(line.locator(".status-model")).toHaveCount(0);
  await expect(line.locator(".status-spinner")).toHaveCount(0);

  // j moves block by block: onto slide 2, then slide 3.
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect(line.locator(".status-slide")).toHaveText("2/3");
  await page.keyboard.press("G");
  await expect(line.locator(".status-slide")).toHaveText("3/3");

  // Ask about the line: the spinner turns while the answer streams, and the model the core named
  // shows; when the answer is in, the spinner goes and the model stays.
  await page.keyboard.press("a");
  await page.keyboard.type("why two dice?");
  await page.keyboard.press("Enter");
  await expect(line.getByRole("img", { name: "1 AI job running" })).toBeVisible();
  await expect(line.getByTitle("Active model")).toHaveText("sample");
  await evidence(page, "status-line-streaming");
  await expect(line.locator(".status-jobs")).toHaveCount(0, { timeout: 10_000 });
  await expect(line.getByTitle("Active model")).toHaveText("sample");
  await evidence(page, "status-line");
  // The dark scheme, for docs/design/reference/dark/status-line.png: the mode keeps its colours.
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(line.locator(".status-mode")).toHaveCSS("background-color", await tokenColour(page, "--accent-bg"));
  await evidence(page, "status-line-dark");
  expect(errors).toEqual([]);
});

test("the mode segment changes colour per mode: NORMAL, INSERT, VISUAL, COMMAND", async ({ page }) => {
  await openLecture(page);
  const mode = page.getByRole("status", { name: "Status line" }).locator(".status-mode");
  const expectMode = async (label: string, bg: string, fg: string) => {
    await expect(mode).toHaveText(label);
    await expect(mode).toHaveCSS("background-color", await tokenColour(page, bg));
    await expect(mode).toHaveCSS("color", await tokenColour(page, fg));
  };

  await expectMode("NORMAL", "--accent-bg", "--accent-fg");
  await page.keyboard.press("i");
  await expectMode("INSERT", "--k-ask", "--view-bg");
  await evidence(page, "status-line-insert");
  await page.keyboard.press("Escape");
  await expectMode("NORMAL", "--accent-bg", "--accent-fg");
  await page.keyboard.press("v");
  await expectMode("VISUAL", "--k-source", "--view-bg");
  await evidence(page, "status-line-visual");
  await page.keyboard.press("Escape");
  await expectMode("NORMAL", "--accent-bg", "--accent-fg");
  // `:` opens Lecter's command line: COMMAND until it closes.
  await page.keyboard.press(":");
  await expect(page.getByRole("dialog", { name: "Command line" })).toBeVisible();
  await expectMode("COMMAND", "--k-later", "--view-bg");
  await evidence(page, "status-line-command");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Command line" })).toBeHidden();
  await expectMode("NORMAL", "--accent-bg", "--accent-fg");
  // Each mode has its own colour.
  const colours = await Promise.all(
    ["--accent-bg", "--k-ask", "--k-source", "--k-later"].map((t) => tokenColour(page, t)),
  );
  expect(new Set(colours).size).toBe(4);
});
