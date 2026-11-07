// The real-app flows (tests/e2e/flows, run by CI's e2e-app job on all three OSes) call core
// commands through tests/e2e/support/invoke.ts, typed by the generated contract. Type-checking
// them here makes a command's new required argument fail locally, in ui-tests, instead of only on
// CI's real app (F-045: settings_set gained `scope`).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/** The repository root: the first folder up from the working folder that holds tests/e2e. */
function repoRoot(from: string): string {
  if (existsSync(join(from, "tests", "e2e", "tsconfig.json"))) return from;
  const up = dirname(from);
  if (up === from) throw new Error(`tests/e2e not found above ${process.cwd()}`);
  return repoRoot(up);
}

describe("the real-app flows", () => {
  it("type-check against the generated IPC contract", () => {
    const root = repoRoot(process.cwd());
    const tsc = join(root, "ui", "node_modules", "typescript", "bin", "tsc");
    const run = spawnSync(process.execPath, [tsc, "--noEmit", "-p", join(root, "tests", "e2e", "tsconfig.json")], {
      encoding: "utf8",
    });
    expect(`${run.stdout}${run.stderr}`).toBe("");
    expect(run.status).toBe(0);
  }, 120_000);
});
