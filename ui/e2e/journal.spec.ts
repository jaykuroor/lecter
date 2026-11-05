import type { Edit } from "../src/core/lecture";
import { defaultFixture, expect, test, trustScreen } from "./mock-core";
import { sampleLecture } from "./mock-core/lectures";

// F-021: what the student types reaches the core as `lecture_apply_edits` calls that, applied in
// order, give exactly the buffer's text. The mocked core records each call in
// `window.__mockEdits`; the real core's journal and save are tested in Rust and the real-app flow.

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
  },
});

interface Sent {
  course: string;
  path: string;
  edits: Edit[];
}

test("typing reaches the core as edits that rebuild the buffer @smoke", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add a course" }).click();
  await page.getByRole("button", { name: "2026-10-23-l07-covariance.md" }).click();
  await expect(page.locator(".cm-focused-line")).toHaveText("Covariance measures how two variables move together.");

  await page.keyboard.press("i");
  await expect(page.locator(".lecture-buffer")).toHaveAttribute("data-vim-mode", "insert");
  await page.keyboard.type("Note: ");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("é𝑥 ");
  await page.keyboard.press("Escape");
  await expect(page.locator(".cm-focused-line")).toHaveText(
    "Note:é𝑥 Covariance measures how two variables move together.",
  );

  const read = () =>
    page.evaluate(() => ({
      sent: (window as unknown as { __mockEdits?: Sent[] }).__mockEdits ?? [],
      doc: document.querySelector(".cm-content")?.textContent ?? "",
    }));
  await expect.poll(async () => (await read()).sent.flatMap((s) => s.edits).length).toBeGreaterThan(8);
  const { sent } = await read();
  expect(new Set(sent.map((s) => `${s.course}|${s.path}`))).toEqual(new Set([`/courses/STAT311|${lecturePath}`]));
  let text = sampleLecture;
  for (const e of sent.flatMap((s) => s.edits)) text = text.slice(0, e.from) + e.text + text.slice(e.to);
  const at = sampleLecture.indexOf("Covariance measures");
  expect(text).toBe(`${sampleLecture.slice(0, at)}Note:é𝑥 ${sampleLecture.slice(at)}`);
});
