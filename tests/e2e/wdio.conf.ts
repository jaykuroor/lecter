// WebdriverIO against the real app (16-ci-cd.md, e2e-app job; D-049). Protected: edit only as a
// feature's criteria require. Run it through scripts/e2e-app.sh, which builds the debug app with
// the embedded WebDriver server (`--features test-hooks`), makes the throwaway test home and
// course, and sets LECTER_TEST_HOME / LECTER_TEST_PICK / LECTER_TEST_TRUST for the app.
//
// Only node: imports and support/ files here: this folder has no node_modules, so packages (the
// service, the framework, the reporter) are named as strings and resolve from ui/, where the
// script runs wdio.

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseShard, plan } from "./support/shards";
import { timings } from "./support/timings";
import { type Session, skipFocusCheck } from "./support/window";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const exe = process.platform === "win32" ? "lecter-app.exe" : "lecter-app";

/** The flows to run: the named ones, one CI shard's, or every flow. */
function flows(): string[] {
  // `scripts/e2e-app.sh shell idle`: space-separated names.
  const named = (process.env.LECTER_E2E_FLOW ?? "").split(/\s+/).filter(Boolean);
  if (named.length > 0) return named;
  // A CI shard (`LECTER_E2E_SHARD=2/4`, support/shards.ts, D-154).
  const shard = process.env.LECTER_E2E_SHARD;
  if (!shard) return [];
  const { index, total } = parseShard(shard);
  const all = readdirSync(join(here, "flows"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => f.slice(0, -3));
  const mine = plan(all, process.platform, total)[index - 1];
  // Never fall back to every flow: a shard runs only its own.
  if (!mine || mine.length === 0) throw new Error(`shard ${shard} has no flows`);
  return mine;
}
const chosen = flows();
// Per-flow wall time to the run's output and the CI job summary (support/timings.ts, D-154).
const times = timings(
  process.env.LECTER_E2E_OUT,
  process.env.GITHUB_STEP_SUMMARY,
  `e2e-app flow times (${process.platform}${process.env.LECTER_E2E_SHARD ? `, shard ${process.env.LECTER_E2E_SHARD}` : ""})`,
);

export const config = {
  runner: "local",
  specs: chosen.length > 0 ? chosen.map((f) => join(here, "flows", `${f}.ts`)) : [join(here, "flows", "*.ts")],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": { application: join(root, "target", "debug", exe) },
    },
  ],
  services: [
    [
      "@wdio/tauri-service",
      {
        // The server inside the app (tauri-plugin-wdio-webdriver) on all three OSes; no
        // tauri-driver, msedgedriver or WebKitWebDriver.
        driverProvider: "embedded",
        autoDownloadEdgeDriver: false,
        // The app's stdout and stderr go to the worker log, which the script saves as app.log.
        captureBackendLogs: true,
        backendLogLevel: "trace",
        captureFrontendLogs: true,
        frontendLogLevel: "trace",
      },
    ],
  ],
  // scripts/e2e-app.sh already runs under xvfb-run on Linux without a display.
  autoXvfb: false,
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 120_000 },
  reporters: ["spec"],
  // "debug" would print the app's whole environment.
  logLevel: "info",
  outputDir: process.env.LECTER_E2E_OUT,
  waitforTimeout: 15_000,
  bail: 0,
  // Each flow's session: no 5 s window-focus wait before every find and click (support/window.ts).
  before: (_caps: unknown, _specs: string[], session: Session) => skipFocusCheck(session),
  onWorkerStart: times.onWorkerStart,
  onWorkerEnd: times.onWorkerEnd,
  onComplete: times.onComplete,
};
