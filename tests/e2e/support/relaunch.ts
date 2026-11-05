// Relaunching the app without the trust test hook, for the flows that answer the trust screen
// themselves (trust.ts, course-details.ts). Every other flow runs with LECTER_TEST_TRUST=1, which
// answers the screen before it shows. Such a flow quits the service's app and starts its own
// without the hook, on the same WebDriver port, as restart.ts does, with the folder dialog
// answering a course of its own. The flow stops that app in `after` with `stopRelaunched`; the
// next flow's worker finds the port closed and the service starts a fresh app.

import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { skipFocusCheck } from "./window.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const APP = join(root, "target", "debug", process.platform === "win32" ? "lecter-app.exe" : "lecter-app");
const HOOK = "LECTER_TEST_TRUST";

/** A course folder of the flow's own, next to the shared one, so no stored answer covers it. */
export function ownCourse(name: string): string {
  const shared = process.env.LECTER_TEST_PICK;
  if (!shared) throw new Error("LECTER_TEST_PICK is not set: run flows through scripts/e2e-app.sh");
  return join(dirname(shared), name);
}

const port = (): number => browser.options.port ?? 4445;
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/**
 * Quits the service's app (it has the hook) and starts one without it, its folder dialog
 * answering `course`; its output goes to `<log>.log` in the run's output folder. `whileClosed`
 * runs once the old app has quit and before the new one starts (e.g. to reset the app's state).
 */
export async function relaunchWithoutTrustHook(course: string, log: string, whileClosed?: () => void): Promise<void> {
  await browser.closeWindow().catch(() => undefined);
  await waitFor(async () => !(await alive()), 30_000, "the app to quit");
  whileClosed?.();
  const out = process.env.LECTER_E2E_OUT;
  const file = out ? openSync(join(out, `${log}.log`), "w") : "ignore";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LECTER_TEST_PICK: course,
    TAURI_WEBDRIVER_PORT: String(port()),
    WDIO_EMBEDDED_SERVER: "true",
  };
  delete env[HOOK];
  relaunched = spawn(APP, [], { env, stdio: ["ignore", file, file] });
  if (typeof file === "number") closeSync(file);
  await waitFor(alive, 60_000, "the relaunched app's WebDriver server");
  await browser.reloadSession();
  // A new session: switch the service's focus check off again (wdio.conf.ts did the first one).
  await skipFocusCheck(browser);
}

/** Ends the session while its app still runs, then stops the app (see restart.ts). */
export async function stopRelaunched(): Promise<void> {
  await browser.deleteSession().catch(() => undefined);
  (browser as unknown as { sessionId?: string }).sessionId = undefined;
  relaunched?.kill();
  relaunched = null;
}
