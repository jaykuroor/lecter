// F-026: a slide PDF becomes a lecture file. The app has no import command yet (new lecture from
// slides is F-061), so the skeleton parses with the core's worker path through `lecter-harness
// parse` (F-019: the lecter-parse worker in a child process, PDFium, the worker protocol) and
// writes its blocks as the lecture file of 03-lecture-files.md#body: one `.slide` div per page,
// the page's first block as its title and `##` heading, every other block as a `[text]{#id}` span
// with the id the parser gave it.

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const HARNESS = join(root, "target", "debug", process.platform === "win32" ? "lecter-harness.exe" : "lecter-harness");

/** One block of `lecter-harness parse --json` (the fields this uses). */
export interface ParsedBlock {
  id: string;
  page: number;
  text: string;
}

/** Builds the debug harness next to the app (the e2e-app build makes only lecter-app). */
export function buildHarness(): void {
  execFileSync("cargo", ["build", "-q", "-p", "lecter-harness", "--locked"], { cwd: root, stdio: "pipe" });
}

/** Parses `pdf` with `lecter-harness parse <pdf> --json` and returns its blocks. */
export function parsePdf(pdf: string): ParsedBlock[] {
  const out = execFileSync(HARNESS, ["parse", pdf, "--json"], { cwd: root, encoding: "utf8", stdio: "pipe" });
  const parsed = JSON.parse(out) as { blocks?: ParsedBlock[] };
  if (!Array.isArray(parsed.blocks)) throw new Error(`lecter-harness parse printed no blocks: ${out}`);
  return parsed.blocks;
}

/** A block's text on one line: the buffer and search read one span per line. */
function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  // Text that would need escaping in a span is refused rather than written wrong.
  if (/[[\]{}\\"]/.test(flat)) throw new Error(`block text needs escaping, which the skeleton doesn't do: ${flat}`);
  return flat;
}

/** The lecture file for `blocks` of the slide file `slides` (course-relative). */
export function lectureFile(blocks: ParsedBlock[], meta: { lecture: number; date: string; slides: string }): string {
  const pages = [...new Set(blocks.map((b) => b.page))].sort((a, b) => a - b);
  if (pages.length === 0) throw new Error("the PDF has no text blocks");
  const slides = pages.map((page) => {
    const [first, ...rest] = blocks.filter((b) => b.page === page);
    const title = oneLine(first?.text ?? "");
    const spans = rest.flatMap((b) => {
      if (!b.id.startsWith(`s${page}b`)) throw new Error(`block ${b.id} is not on slide s${page}`);
      return [`[${oneLine(b.text)}]{#${b.id}}`, ""];
    });
    return [`::: {.slide #s${page} n=${page} title="${title}"}`, `## ${title}`, "", ...spans, ":::", ""];
  });
  const title = oneLine(blocks.find((b) => b.page === pages[0])?.text ?? "");
  const front = ["---", "lecter: 1", `lecture: ${meta.lecture}`, `date: ${meta.date}`, `title: ${title}`];
  return [...front, "slides:", `  - ${meta.slides}`, "---", "", ...slides.flat()].join("\n");
}
