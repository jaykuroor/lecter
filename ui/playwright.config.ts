import { createHash } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// Protected (14-quality.md#protected-checks): retries stay 0, and the smoke project stays Chromium only.
// The UI runs against the mocked core (e2e/mock-core), never against Tauri IPC.

// A port derived from this checkout's path, so parallel worktrees don't serve each other's code;
// LECTER_E2E_PORT overrides it.
const port =
  Number(process.env.LECTER_E2E_PORT) ||
  20000 +
    (createHash("sha256")
      .update(import.meta.dirname)
      .digest()
      .readUInt16BE(0) %
      20000);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  retries: 0,
  forbidOnly: true,
  fullyParallel: true,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  use: { baseURL, trace: "retain-on-failure" },
  webServer: {
    command: `pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: "smoke", grep: /@smoke/, use: { ...devices["Desktop Chrome"] } },
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
