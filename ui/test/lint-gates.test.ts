// @vitest-environment node
// F-014 criterion 4: jscpd (lint:dup) fails on a copied block of 30+ lines in ui/src or crates, and
// knip (lint:unused) fails on an unused export. Each tool runs with the real config file against a
// throwaway tree in the temp dir; the lint stage runs the same configs against the real tree.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const ui = dirname(dirname(fileURLToPath(import.meta.url)));
const jscpd = join(ui, "node_modules/jscpd/run-jscpd.js");
const knip = join(ui, "node_modules/knip/bin/knip.js");
const TIMEOUT = 60_000;

let scratch = "";
afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = "";
});

/** A fresh tree in the temp dir, with `files` (path → text) written into it. */
function tree(files: Record<string, string>): string {
  scratch = mkdtempSync(join(tmpdir(), "lecter-lint-gates-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(scratch, rel)), { recursive: true });
    writeFileSync(join(scratch, rel), text);
  }
  return scratch;
}

function run(bin: string, args: string[], cwd: string): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: "utf8", env: { ...process.env, CI: "1" } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** `n` distinct statements, one per line, in TypeScript or Rust. */
function block(n: number, lang: "ts" | "rs"): string {
  const lines = Array.from({ length: n }, (_, i) =>
    lang === "ts"
      ? `  const v${i} = compute(${i}, "k${i}") + other(${i} * 2);`
      : `    let v${i} = compute(${i}, "k${i}") + other(${i} * 2);`,
  );
  return lines.join("\n");
}

function dupTree(lines: number, where: "ui" | "crates"): string {
  const files: Record<string, string> =
    where === "ui"
      ? {
          "ui/src/a.ts": `export function a(): void {\n${block(lines, "ts")}\n}\n`,
          "ui/src/b.ts": `export function b(): void {\n${block(lines, "ts")}\n}\n`,
        }
      : {
          "crates/x/src/a.rs": `pub fn a() {\n${block(lines, "rs")}\n}\n`,
          "crates/y/src/b.rs": `pub fn b() {\n${block(lines, "rs")}\n}\n`,
        };
  const root = tree(files);
  mkdirSync(join(root, "ui/src"), { recursive: true });
  mkdirSync(join(root, "crates"), { recursive: true });
  mkdirSync(join(root, "app/src"), { recursive: true });
  copyFileSync(join(ui, ".jscpd.json"), join(root, "ui/.jscpd.json"));
  return join(root, "ui");
}

describe("jscpd (lint:dup)", () => {
  for (const where of ["ui", "crates"] as const) {
    it(
      `fails on a 30-line copied block in ${where === "ui" ? "ui/src" : "crates"}`,
      () => {
        const r = run(jscpd, ["--config", ".jscpd.json"], dupTree(30, where));
        expect(r.code, r.out).toBe(1);
        expect(r.out).toMatch(/[1-9]\d* clones?/);
      },
      TIMEOUT,
    );
  }

  it(
    "passes a copied block shorter than 30 lines",
    () => {
      const r = run(jscpd, ["--config", ".jscpd.json"], dupTree(20, "ui"));
      expect(r.code, r.out).toBe(0);
    },
    TIMEOUT,
  );
});

describe("knip (lint:unused)", () => {
  const project = (lib: string): string => {
    const root = tree({
      "package.json": '{ "name": "knip-fixture", "private": true, "type": "module" }\n',
      "src/main.tsx": 'import { used } from "./lib";\nconsole.log(used);\n',
      "src/lib.ts": lib,
    });
    copyFileSync(join(ui, "knip.json"), join(root, "knip.json"));
    return root;
  };

  it(
    "fails on an unused export",
    () => {
      const r = run(knip, ["--no-progress"], project("export const used = 1;\nexport const unusedThing = 2;\n"));
      expect(r.code, r.out).toBe(1);
      expect(r.out).toContain("unusedThing");
    },
    TIMEOUT,
  );

  it(
    "passes when every export is used",
    () => {
      const r = run(knip, ["--no-progress"], project("export const used = 1;\n"));
      expect(r.code, r.out).toBe(0);
    },
    TIMEOUT,
  );
});
