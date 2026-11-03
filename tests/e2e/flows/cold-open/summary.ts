// The cold-open flow's lines in the CI job summary as well as the log (as tests/e2e/flows/ime.ts
// does, D-141): verify.sh prints only "PASS" for a passing stage and keeps its logs only on a
// failure, so the median that sets an OS's target (D-152) would otherwise be lost.

import { appendFileSync } from "node:fs";

/**
 * A `report(line)` that prints `line` and, when `summary` (GITHUB_STEP_SUMMARY) names a file,
 * appends it there too: under one heading, indented four spaces so all the lines form one Markdown
 * code block that reads exactly as the log.
 */
export function reporter(summary: string | undefined): (line: string) => void {
  let started = false;
  return (line) => {
    console.log(line);
    if (!summary) return;
    const head = started ? "" : "\n#### F-179 cold open (cold_open_ms, D-152)\n\n";
    started = true;
    appendFileSync(summary, `${head}    ${line}\n`);
  };
}
