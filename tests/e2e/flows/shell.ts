// F-016 criterion 2: the real app opens and its shell is visible (components.md#app-frame),
// with the status line showing the version the real core reports (`app_info`).

import { shot } from "../support/shot.ts";

describe("shell", () => {
  it("opens the app and shows the shell", async () => {
    for (const label of ["Course rail", "Document", "Side panel", "Status line"]) {
      await expect($(`[aria-label="${label}"]`)).toBeDisplayed();
    }
    await expect($("h1")).toHaveText("Lecter");
    // "Connecting to core…" until app_info answers; then the version from tauri.conf.json.
    await expect($('[role="status"]')).toHaveText(/^v\d+\.\d+\.\d+$/);
    await shot("shell");
  });
});
