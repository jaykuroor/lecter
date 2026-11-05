import { defaultFixture, expect, test, trustScreen } from "./mock-core";

// F-033: the first open of a folder shows the trust screen over the document: what is inside,
// what the AI may read, the provider that receives excerpts, web search, and the course's own
// AI files. Trust or Open read-only, by mouse or by key, goes to `course_trust`; a read-only
// course is marked in the rail. Against the mocked core (the core's enforcement is tested in Rust
// and through lecter-harness; the real app in tests/e2e/flows/trust.ts).

test.use({
  mockCore: {
    ...defaultFixture,
    courseOpen: {
      path: "/courses/STAT311",
      name: "STAT311",
      lectures: [{ name: "2026-10-23-l07-covariance.md", path: "lectures/2026-10-23-l07-covariance.md" }],
      slides: [{ name: "07-covariance.pdf", path: "slides/07-covariance.pdf" }],
      sources: [],
      trust: "ask",
      screen: {
        ...trustScreen,
        lectures: 6,
        slides: 12,
        sources: 3,
        agents: ["AGENTS.md"],
        roles: [".lecter/agents/tutor.md"],
        skills: [".lecter/skills/flashcards"],
        overrides: ["ui.performance"],
      },
    },
  },
});

test("a first open shows the trust screen; Trust answers it @smoke", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Add a course" }).click();
  const dialog = page.getByRole("dialog", { name: "Trust “STAT311”?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("6 lectures · 12 slide decks · 3 sources")).toBeVisible();
  await expect(dialog.locator(".trust-provider")).toHaveText("sample");
  await expect(dialog.locator(".trust-web")).toHaveText("On");
  await expect(dialog.getByRole("region", { name: "Course instructions" }).locator("li")).toHaveText(["AGENTS.md"]);
  await expect(dialog.getByRole("region", { name: "Roles" }).locator("li")).toHaveText([".lecter/agents/tutor.md"]);
  await expect(dialog.getByRole("region", { name: "Skills" }).locator("li")).toHaveText([".lecter/skills/flashcards"]);
  await expect(dialog.getByRole("region", { name: "Settings overrides" }).locator("li")).toHaveText(["ui.performance"]);
  await expect(dialog.getByRole("button", { name: "Open read-only" })).toBeFocused();
  const shot = testInfo.outputPath("trust-screen.png");
  await page.screenshot({ path: shot });
  if (process.env.LECTER_EVIDENCE_DIR)
    await page.screenshot({ path: `${process.env.LECTER_EVIDENCE_DIR}/trust-screen.png` });

  await dialog.getByRole("button", { name: "Trust" }).click();
  await expect(dialog).toBeHidden();
  const sent = await page.evaluate(() => (window as unknown as { __mockTrust?: unknown[] }).__mockTrust);
  expect(sent).toEqual([{ course: "/courses/STAT311", choice: "trusted" }]);
  await expect(page.getByText("Read-only")).toHaveCount(0);
});

test("Open read-only by key marks the course read-only", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add a course" }).click();
  const dialog = page.getByRole("dialog", { name: "Trust “STAT311”?" });
  await expect(dialog.getByRole("button", { name: "Open read-only" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  const sent = await page.evaluate(() => (window as unknown as { __mockTrust?: unknown[] }).__mockTrust);
  expect(sent).toEqual([{ course: "/courses/STAT311", choice: "read_only" }]);
  await expect(page.getByRole("navigation", { name: "Course rail" }).getByText("Read-only")).toBeVisible();
  // Notes still open in a read-only course.
  await expect(page.getByRole("button", { name: "2026-10-23-l07-covariance.md" })).toBeVisible();
});
