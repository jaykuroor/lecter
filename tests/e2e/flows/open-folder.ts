// F-016 criterion 4: LECTER_TEST_PICK answers the native folder dialog and LECTER_TEST_TRUST the
// trust question, so opening a folder never shows a dialog (01-architecture.md#debug-only-test-hooks).
// A real dialog would block `course_open` until someone answered it, and the call would time out.

import { basename } from "node:path";
import { shot } from "../support/shot.ts";

interface CourseOpened {
  path: string;
  name: string;
  trust: "ask" | "trusted";
}

describe("open folder", () => {
  it("opens the picked folder without a dialog, with trust answered", async () => {
    const picked = process.env.LECTER_TEST_PICK;
    if (!picked) throw new Error("LECTER_TEST_PICK is not set: run flows through scripts/e2e-app.sh");
    await expect($('[aria-label="Document"]')).toBeDisplayed();

    // The UI has no Open button until F-018, so the flow calls the command the way the UI will.
    const opened = await browser.execute(() => {
      const w = window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string) => Promise<unknown> };
      };
      return w.__TAURI_INTERNALS__.invoke("course_open");
    });

    const course = opened as CourseOpened | null;
    expect(course).not.toBeNull();
    expect(course?.name).toBe(basename(picked));
    expect(course?.trust).toBe("trusted");
    // No second window and the main one still answers: nothing is waiting on a dialog.
    expect(await browser.getWindowHandles()).toHaveLength(1);
    await expect($('[aria-label="Document"]')).toBeDisplayed();
    await shot("open-folder");
  });
});
