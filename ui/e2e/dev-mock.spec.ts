import { expect, test } from "@playwright/test";
import { defaultFixture } from "./mock-core";

// `pnpm run dev` in a plain browser (no Tauri, no Playwright mock) serves the default mocked core.
test("dev server renders the shell against the default mocked core", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Status line" })).toContainText(`v${defaultFixture.appInfo.version}`);
});
