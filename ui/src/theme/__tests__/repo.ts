// Repo files for the theme's tests: docs/design/tokens.json (the design tokens, read-only spec
// input) and the ui/src tree the hard-coded-colour lint scans. Found by walking up from the
// working folder (ui/, or a mutation run's copy of it further down), as jsdom can't read files
// through import.meta.url.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

function above(from: string, rel: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    const here = join(dir, rel);
    if (existsSync(here)) return here;
    if (dirname(dir) === dir) throw new Error(`${rel} not found above ${from}`);
  }
}

/** docs/design/tokens.json, parsed. */
export function designTokens(): unknown {
  return JSON.parse(readFileSync(above(process.cwd(), join("docs", "design", "tokens.json")), "utf8"));
}

/** The folder of the ui/src tree under test. */
export function uiSrc(): string {
  return dirname(above(process.cwd(), join("src", "theme")));
}

/** Every file under `dir`, as [path relative to `dir` with `/`, text]. */
export function filesUnder(dir: string): [string, string][] {
  const out: [string, string][] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push([relative(dir, p).split("\\").join("/"), readFileSync(p, "utf8")]);
    }
  };
  walk(dir);
  return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}
