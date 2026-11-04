// F-026: quitting the app and starting it again inside one flow, as tests/e2e/flows/restart.ts
// does (F-021). The service starts the app once per flow; the flow relaunches it itself on the same
// WebDriver port (TAURI_WEBDRIVER_PORT, as the service does) and reconnects with `reloadSession`.
// `stop()` in the flow's `after` ends the session and the relaunched app.

import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { skipFocusCheck } from "../../support/window.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const APP = join(root, "target", "debug", process.platform === "win32" ? "lecter-app.exe" : "lecter-app");

const port = (): number => browser.options.port ?? 4445;
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Whether the app's WebDriver server answers. */
async function alive(): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${port()}/status`, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

/** Polls `done` until it holds or `ms` pass. */
async function waitFor(done: () => Promise<boolean>, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await done())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await tick(50);
  }
}

let relaunched: ChildProcess | null = null;

/** Quits the app by closing its only window (which saves open lectures) and waits until it is gone. */
export async function quit(): Promise<void> {
  await browser.closeWindow().catch(() => undefined);
  await waitFor(async () => !(await alive()), 30_000, "the app to quit");
}

/** Starts the app again on the WebDriver port and reconnects the session to it. */
export async function relaunch(): Promise<void> {
  const out = process.env.LECTER_E2E_OUT;
  const log = out ? openSync(join(out, "skeleton-relaunch.log"), "w") : "ignore";
  relaunched = spawn(APP, [], {
    env: { ...process.env, TAURI_WEBDRIVER_PORT: String(port()), WDIO_EMBEDDED_SERVER: "true" },
    stdio: ["ignore", log, log],
  });
  if (typeof log === "number") closeSync(log);
  await waitFor(alive, 60_000, "the relaunched app's WebDriver server");
  await browser.reloadSession();
  // A new session: switch the service's focus check off again (wdio.conf.ts did the first one).
  await skipFocusCheck(browser);
}

/** Ends the session while its app still runs, then stops the relaunched app. */
export async function stop(): Promise<void> {
  // Not relaunched: the service's own app and session end as usual.
  if (!relaunched) return;
  // The runner's endSession DELETEs the session only while `browser.sessionId` is set; left set,
  // that DELETE would reach a closed port and fail the flow after its tests passed.
  await browser.deleteSession().catch(() => undefined);
  (browser as unknown as { sessionId?: string }).sessionId = undefined;
  relaunched?.kill();
}
