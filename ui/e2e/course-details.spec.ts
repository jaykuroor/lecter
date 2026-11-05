import { defaultFixture, expect, test, trustScreen } from "./mock-core";

// F-034: after the user trusts a course, the course details form collects its name, code, term,
// professor, icon, colour and folder mapping, pre-filled from the folder names; Save sends them to
// `course_details_save` (which writes .lecter/course.jsonc with "version": 1: tested in Rust and
// in the real app, tests/e2e/flows/course-details.ts). Against the mocked core.

test.use({
  mockCore: {
    ...defaultFixture,
    courseOpen: {
      path: "/courses/STAT311 - Probability and Statistics",
      name: "STAT311 - Probability and Statistics",
      lectures: [{ name: "2026-10-23-l07-covariance.md", path: "lectures/2026-10-23-l07-covariance.md" }],
      slides: [{ name: "07-covariance.pdf", path: "slides/07-covariance.pdf" }],
      trust: "ask",
      screen: { ...trustScreen, lectures: 6, slides: 12, sources: 3 },
    },
    details: {
      name: "Probability and Statistics",
      code: "STAT 311",
      term: "",
      professor: "",
      icon: "S",
      color: "#3584e4",
      folders: { slides: "slides", sources: "sources", lectures: "lectures", pastPapers: "sources/past-papers" },
    },
  },
});

test("Trust brings the course details form; Save sends the details @smoke", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Add a course" }).click();
  await page
    .getByRole("dialog", { name: /^Trust/ })
    .getByRole("button", { name: "Trust" })
    .click();
  const form = page.getByRole("dialog", { name: "Course details" });
  await expect(form).toBeVisible();
  await expect(form.getByLabel("Name")).toBeFocused();
  await expect(form.getByLabel("Name")).toHaveValue("Probability and Statistics");
  await expect(form.getByLabel("Code")).toHaveValue("STAT 311");
  await expect(form.getByLabel("Past papers")).toHaveValue("sources/past-papers");
  await form.getByLabel("Term").fill("Fall 2026");
  await form.getByLabel("Professor").fill("Dr. Rivera");
  await page.screenshot({ path: testInfo.outputPath("course-details.png") });
  if (process.env.LECTER_EVIDENCE_DIR)
    await page.screenshot({ path: `${process.env.LECTER_EVIDENCE_DIR}/course-details.png` });

  await form.getByRole("button", { name: /^Save/ }).click();
  await expect(form).toBeHidden();
  const sent = await page.evaluate(() => (window as unknown as { __mockDetails?: unknown[] }).__mockDetails);
  expect(sent).toEqual([
    {
      course: "/courses/STAT311 - Probability and Statistics",
      details: {
        name: "Probability and Statistics",
        code: "STAT 311",
        term: "Fall 2026",
        professor: "Dr. Rivera",
        icon: "S",
        color: "#3584e4",
        folders: { slides: "slides", sources: "sources", lectures: "lectures", pastPapers: "sources/past-papers" },
      },
    },
  ]);
});

test("Escape closes the form without saving; Open read-only never shows it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add a course" }).click();
  await page
    .getByRole("dialog", { name: /^Trust/ })
    .getByRole("button", { name: "Trust" })
    .click();
  const form = page.getByRole("dialog", { name: "Course details" });
  await expect(form.getByLabel("Name")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(form).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { __mockDetails?: unknown[] }).__mockDetails)).toBeUndefined();

  await page.reload();
  await page.getByRole("button", { name: "Add a course" }).click();
  await page
    .getByRole("dialog", { name: /^Trust/ })
    .getByRole("button", { name: "Open read-only" })
    .click();
  await expect(page.getByRole("navigation", { name: "Course rail" }).getByText("Read-only")).toBeVisible();
  await expect(form).toHaveCount(0);
});
