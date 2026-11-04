// WebdriverIO for the real-app budgets (tests/perf/app/run.sh, F-025): the e2e setup
// (tests/e2e/wdio.conf.ts: embedded WebDriver; here a release-profile build with test hooks), one measurement file
// per run, so each gets a fresh app process. Log capture is off: the frontend capture talks to the
// page and the backend capture raises the app's log level, and either would be measured.
//
// Only node: imports here: packages resolve from ui/, where run.sh runs wdio.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const spec = process.env.LECTER_PERF_SPEC;
const app = process.env.LECTER_PERF_APP;
if (!spec || !/^[a-z0-9-]+$/.test(spec) || !app)
  throw new Error("run through tests/perf/app/run.sh (LECTER_PERF_SPEC, LECTER_PERF_APP)");

export const config = {
  runner: "local",
  specs: [join(here, `${spec}.perf.ts`)],
  maxInstances: 1,
  capabilities: [{ browserName: "tauri", "tauri:options": { application: app } }],
  services: [
    [
      "@wdio/tauri-service",
      {
        driverProvider: "embedded",
        autoDownloadEdgeDriver: false,
        captureBackendLogs: false,
        captureFrontendLogs: false,
      },
    ],
  ],
  autoXvfb: false,
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 600_000 },
  reporters: ["spec"],
  logLevel: "warn",
  outputDir: process.env.LECTER_E2E_OUT,
  bail: 0,
};