// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import playwrightConfig from "../playwright.config";

const read = (file: string): unknown => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));

interface PackageJson {
  packageManager?: string;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
}

describe("ui scaffold", () => {
  const pkg = read("package.json") as PackageJson;

  it("pins the Node LTS and pnpm versions (D-058)", () => {
    expect(pkg.packageManager).toBe("pnpm@12.15.0");
    expect(pkg.engines).toEqual({ node: "24.18.0", pnpm: "12.15.0" });
  });

  it("provides the scripts verify.sh calls", () => {
    const scripts = pkg.scripts ?? {};
    for (const name of ["build", "test:e2e", "test:e2e:smoke", "lint:dup", "lint:unused"]) {
      expect(scripts[name], name).toBeTruthy();
    }
    expect(scripts["lint:dup"]).toMatch(/^jscpd\b/);
    expect(scripts["lint:unused"]).toMatch(/^knip\b/);
    expect(scripts["test:e2e:smoke"]).toContain("@smoke");
  });

  it("compiles TypeScript strictly with no implicit any", () => {
    const ts = read("tsconfig.json") as {
      compilerOptions: Record<string, unknown>;
    };
    expect(ts.compilerOptions.strict).toBe(true);
    expect(ts.compilerOptions.noImplicitAny).toBe(true);
  });

  it("runs Playwright with no retries and a Chromium-only smoke project", () => {
    expect(playwrightConfig.retries).toBe(0);
    const smoke = playwrightConfig.projects?.find((p) => p.name === "smoke");
    expect(smoke?.use?.defaultBrowserType ?? smoke?.use?.browserName).toBe("chromium");
    expect(smoke?.use?.channel).toBeUndefined();
    expect(String(smoke?.grep)).toContain("@smoke");
  });
});
