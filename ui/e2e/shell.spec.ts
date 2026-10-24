import { defaultFixture, expect, test } from "./mock-core";

// A version only this test's mocked core serves, so the shell can only show it if the
// Playwright-installed mock answered `app_info`.
test.use({
  mockCore: {
    ...defaultFixture,
    appInfo: { name: "Lecter", version: "0.0.1-e2e" },
  },
});

test("app shell loads against the mocked core @smoke", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");

  await expect(page.getByRole("banner")).toContainText("Lecter");
  await expect(page.getByRole("navigation", { name: "Course rail" })).toBeVisible();
  await expect(page.getByRole("main", { name: "Document" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Side panel" })).toBeVisible();
  await expect(page.getByRole("status", { name: "Status line" })).toContainText("v0.0.1-e2e");
  expect(errors).toEqual([]);
});
