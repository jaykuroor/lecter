// `await shot("<state>")` saves the window as <state>.png. scripts/e2e-app.sh points
// LECTER_E2E_SHOTS at the run's folder and, with --evidence F-0NN, copies the files to
// .evidence/F-0NN/ (14-quality.md#evidence).

import { join } from "node:path";

const STATE = /^[a-z0-9][a-z0-9-]*$/;

export async function shot(state: string): Promise<void> {
  if (!STATE.test(state)) throw new Error(`shot(): "${state}" is not a lower-case state name`);
  const dir = process.env.LECTER_E2E_SHOTS;
  if (!dir) throw new Error("LECTER_E2E_SHOTS is not set: run flows through scripts/e2e-app.sh");
  await browser.saveScreenshot(join(dir, `${state}.png`));
}
