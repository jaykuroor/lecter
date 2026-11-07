import type { Page } from "@playwright/test";
import type { Edit } from "../src/core/lecture";
import { defaultFixture, expect, test, trustScreen } from "./mock-core";
import { sampleLecture } from "./mock-core/lectures";

// F-048 (10-keymap.md#on-a-slide-line): Enter asks, on a slide line and on an own-note line alike.
// Enter opens the prompt row under the line, a question and Enter stream the answer, and the
// finished gloss is saved under its block or after its note (03-lecture-files.md#body), with
// `key=Enter`. `a` no longer asks. Against the mocked core, which records the buffer's edits.

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
    gloss: { deltas: ["**Sample answer.** ", "From the mocked core."], deltaMs: 30 },
  },
});

async function openLecture(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Add a course" }).click();
  await page.getByRole("button", { name: "2026-10-23-l07-covariance.md" }).click();
  await expect(page.locator(".cm-focused-line")).toHaveText("Covariance measures how two variables move together.");
}

/** The lecture's text as the edits the buffer sent to the core rebuild it. */
async function saved(page: Page): Promise<string> {
  const sent = await page.evaluate(
    () => (window as unknown as { __mockEdits?: { edits: Edit[] }[] }).__mockEdits ?? [],
  );
  let text = sampleLecture;
  for (const e of sent.flatMap((s) => s.edits)) text = text.slice(0, e.from) + e.text + text.slice(e.to);
  return text;
}

const card = (page: Page) => page.locator(".gloss[data-state]");

test("Enter on a slide line asks, and a no longer does @smoke", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openLecture(page);

  // `a` on a slide line: nothing at all.
  await page.keyboard.press("a");
  await expect(page.locator(".lecture-buffer")).toHaveAttribute("data-vim-mode", "normal");
  await expect(card(page)).toHaveCount(0);

  await page.keyboard.press("Enter");
  await expect(card(page)).toHaveAttribute("data-state", "prompt");
  await expect(card(page)).toHaveAttribute("data-anchor", "s1b1");
  await expect(page.locator(".gloss-prompt-input")).toBeFocused();
  if (process.env.LECTER_EVIDENCE_DIR)
    await page.screenshot({ path: `${process.env.LECTER_EVIDENCE_DIR}/ask-enter.png` });
  await page.keyboard.type("why zero?");
  await page.keyboard.press("Enter");
  await expect(card(page)).toHaveCount(0, { timeout: 10_000 });
  const text = await saved(page);
  const block = "[Covariance measures how two variables move together.]{#s1b1}";
  expect(text).toContain(
    `${block}\n\n::: {.gloss #g-0001 kind=ask key=Enter anchor=s1b1 model="sample" by=ai}\n**you asked:** why zero?\n\n**Sample answer.** From the mocked core.\n:::\n`,
  );
  expect(errors).toEqual([]);
});

test("Enter on an own-note line asks about the note, and the gloss goes after it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openLecture(page);
  await page.locator(".cm-line", { hasText: "Try it with numbers." }).click();
  await expect(page.locator(".cm-focused-line")).toHaveText("Try it with numbers.");

  await page.keyboard.press("Enter");
  await expect(card(page)).toHaveAttribute("data-anchor", "n-91c0");
  if (process.env.LECTER_EVIDENCE_DIR)
    await page.screenshot({ path: `${process.env.LECTER_EVIDENCE_DIR}/ask-enter-note.png` });
  await page.keyboard.type("which numbers?");
  await page.keyboard.press("Enter");
  await expect(card(page)).toHaveCount(0, { timeout: 10_000 });
  expect(await saved(page)).toContain(
    '::: {.note #n-91c0 anchor=s2b2}\nTry it with numbers.\n:::\n\n::: {.gloss #g-0001 kind=ask key=Enter anchor=n-91c0 model="sample" by=ai}\n**you asked:** which numbers?\n',
  );
  if (process.env.LECTER_EVIDENCE_DIR)
    await page.screenshot({ path: `${process.env.LECTER_EVIDENCE_DIR}/ask-enter-note-saved.png` });

  // `a` on the note is Vim's append.
  await page.locator(".cm-line", { hasText: "Try it with numbers." }).click();
  await page.keyboard.press("a");
  await expect(page.locator(".lecture-buffer")).toHaveAttribute("data-vim-mode", "insert");
  await expect(card(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});
