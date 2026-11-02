// @vitest-environment node
// F-016 criterion 2: tests/e2e/wdio.conf.ts drives the real debug app through the embedded
// WebDriver server, and every package it names by string resolves from ui/, where
// scripts/e2e-app.sh runs wdio (pnpm's strict node_modules hides undeclared ones).

import { describe, expect, it } from "vitest";
import { config } from "../../tests/e2e/wdio.conf";

describe("real-app e2e config", () => {
  it("uses @wdio/tauri-service with the embedded driver provider", () => {
    const [service] = config.services;
    expect(service?.[0]).toBe("@wdio/tauri-service");
    expect(service?.[1]).toMatchObject({ driverProvider: "embedded" });
  });

  it("launches the debug build, never a release binary", () => {
    const app = config.capabilities[0]?.["tauri:options"].application ?? "";
    expect(app.replaceAll("\\", "/")).toMatch(/\/target\/debug\/lecter-app(\.exe)?$/);
  });

  it("runs the flows in tests/e2e/flows one app at a time", () => {
    expect(config.specs).toHaveLength(1);
    expect(config.specs[0]?.replaceAll("\\", "/")).toMatch(/\/tests\/e2e\/flows\/[^/]+\.ts$/);
    expect(config.maxInstances).toBe(1);
  });

  it("never logs at debug level, which prints the app's whole environment", () => {
    expect(["info", "warn", "error", "silent"]).toContain(config.logLevel);
  });

  it("names only packages that resolve from ui/", () => {
    expect(config.runner).toBe("local");
    expect(config.framework).toBe("mocha");
    expect(config.reporters).toEqual(["spec"]);
    // One literal per package, so the check (and knip) sees each one.
    expect(import.meta.resolve("@wdio/local-runner")).toContain("local-runner");
    expect(import.meta.resolve("@wdio/mocha-framework")).toContain("mocha-framework");
    expect(import.meta.resolve("@wdio/spec-reporter")).toContain("spec-reporter");
    expect(import.meta.resolve("@wdio/tauri-service")).toContain("tauri-service");
    // The flows use its globals (browser, $, expect); tests/e2e/tsconfig.json types them.
    expect(import.meta.resolve("@wdio/globals")).toContain("globals");
  });
});
