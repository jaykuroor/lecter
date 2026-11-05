// The settings schema the core generates and commits (crates/core/src/settings/settings.schema.json,
// D-008): the command line's tests read the real one, so a new or changed setting shows up here.
// Found by walking up from the working folder (ui/, or a mutation run's copy of it further down).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const FILE = join("crates", "core", "src", "settings", "settings.schema.json");

function find(from: string): string {
  const here = join(from, FILE);
  if (existsSync(here)) return here;
  const up = dirname(from);
  if (up === from) throw new Error(`${FILE} not found above ${process.cwd()}`);
  return find(up);
}

export const SCHEMA_TEXT: string = readFileSync(find(process.cwd()), "utf8");
