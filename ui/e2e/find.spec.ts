import { defaultFixture, expect, test, trustScreen } from "./mock-core";
import { sampleLecture } from "./mock-core/lectures";

// F-022: `:find <words>` typed on Vim's command line in the lecture buffer lists the core's
// `search_find` hits, best first, in the side panel; the Find field is the mouse path. Against the
// mocked core (the real index is covered by the WebDriver flow tests/e2e/flows/find.ts).

const lecturePath = "lectures/2026-10-23-l07-covariance.md";
const hit = (block: string, text: string, breadcrumb: string) => ({
  lecture: lecturePath,
  slide: block.slice(0, block.indexOf("b")),
  block,
  text,
  breadcrumb,
});

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
    find: {
      variables: [
        hit("s1b2", "It is zero for independent variables.", "Covariance and Correlation › Covariance"),
        hit("s1b1", "Covariance measures how two variables move together.", "Covariance and Correlation › Covariance"),
      ],
      dice: [hit("s3b1", "Roll two dice and compare the sums.", "Covariance and Correlation › Example")],
    },
  },
});

test(":find in the buffer lists the hits in the side panel @smoke", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Add a course" }).click();
  await page.getByRole("button", { name: "2026-10-23-l07-covariance.md" }).click();
  await expect(page.locator(".lecture-buffer")).toHaveAttribute("data-vim-mode", "normal");

  await page.keyboard.press(":");
  await page.keyboard.type("find variables");
  await page.keyboard.press("Enter");

  const panel = page.getByRole("region", { name: "Find" });
  const rows = panel.locator(".find-hit");
  await expect(rows).toHaveCount(2);
  await expect(rows.locator(".find-hit-where")).toHaveText([
    "2026-10-23-l07-covariance.md · s1b2",
    "2026-10-23-l07-covariance.md · s1b1",
  ]);
  await expect(rows.first().locator(".find-hit-text")).toHaveText("It is zero for independent variables.");
  await expect(panel.getByRole("status")).toHaveText("2 hits for “variables”");
  await expect(panel.getByRole("searchbox", { name: "Find in lectures" })).toHaveValue("variables");
  const finds = await page.evaluate(() => (window as unknown as { __mockFinds?: unknown[] }).__mockFinds);
  expect(finds).toEqual([{ course: "/courses/STAT311", query: "variables" }]);
  // Back in the buffer, in normal mode: the command line closed.
  await expect(page.locator(".lecture-buffer")).toHaveAttribute("data-vim-mode", "normal");
  await page.screenshot({ path: testInfo.outputPath("find.png") });

  // The mouse path: the Find field and button.
  await panel.getByRole("searchbox", { name: "Find in lectures" }).fill("dice");
  await panel.getByRole("button", { name: "Find" }).click();
  await expect(rows.locator(".find-hit-where")).toHaveText(["2026-10-23-l07-covariance.md · s3b1"]);
  await panel.getByRole("searchbox", { name: "Find in lectures" }).fill("eigenvalue");
  await panel.getByRole("searchbox", { name: "Find in lectures" }).press("Enter");
  await expect(panel.getByRole("status")).toHaveText("No hits for “eigenvalue”");
  await expect(rows).toHaveCount(0);
  expect(errors).toEqual([]);
});
