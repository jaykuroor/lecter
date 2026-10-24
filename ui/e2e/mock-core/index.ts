import { test as base } from "@playwright/test";
import { defaultFixture, type MockFixture } from "./fixture";
import { installMockCore } from "./install";

/**
 * Playwright `test` with the mocked core installed before any page script runs.
 * Override the served data per test with `test.use({ mockCore: { ...defaultFixture, … } })`.
 */
export const test = base.extend<{ mockCore: MockFixture }>({
  mockCore: [defaultFixture, { option: true }],
  page: async ({ page, mockCore }, use) => {
    await page.addInitScript(installMockCore, mockCore);
    await use(page);
  },
});

export { expect } from "@playwright/test";
export { defaultFixture, type MockFixture } from "./fixture";
