// The idle attribution's own app (F-180): the release build with test hooks that the cold-open
// flow builds in target/perf/ (tests/e2e/flows/cold-open/launch.ts), started with a fresh home and
// a course holding the 200-slide fixture lecture, on Linux, macOS and Windows. The cold-open
// helpers' stop() reads procfs, so stopping is done here: kill the app, wait for its WebDriver
// port to close and the process to exit.

import { skipFocusCheck } from "../../support/window.ts";
import { alive, buildRelease, type Launch, launch, waitFor } from "../cold-open/launch.ts";

export { APP, LECTURE } from "../cold-open/launch.ts";

/** Builds the release app, closes the service's debug app and starts the release one. */
export async function startRelease(report: (line: string) => void): Promise<Launch> {
  const building = Date.now();
  await buildRelease();
  report(`idle-attribution setup: the release app built in ${Math.round((Date.now() - building) / 1000)} s`);
  // The service's debug app holds the WebDriver port; closing its window quits it.
  await browser.closeWindow().catch(() => undefined);
  await waitFor(async () => !(await alive()), 30_000, "the debug app to quit");
  const app = await launch(1);
  await skipFocusCheck(browser);
  return app;
}

/** Stops the release app and ends the session (the runner has no app left to end it with). */
export async function stopRelease(app: Launch): Promise<void> {
  await browser.deleteSession().catch(() => undefined);
  (browser as unknown as { sessionId?: string }).sessionId = undefined;
  const exited = new Promise<void>((resolve) => {
    if (app.child.exitCode !== null || app.child.signalCode !== null) resolve();
    else app.child.once("exit", () => resolve());
  });
  app.child.kill();
  await waitFor(async () => !(await alive()), 30_000, "the release app to stop");
  await exited;
}
