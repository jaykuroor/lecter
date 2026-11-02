// Where the lecture's figures are: a fenced code block with the info string `fnplot` inside a
// gloss's fenced div (03-lecture-files.md#body), as an answer writes a function plot spec
// (08-figures.md#tiers):
//
//   ::: {.gloss #g-7f3a kind=ask …}
//   **you asked:** plot it
//
//   ```fnplot
//   { "type": "fnplot", "exprs": ["x^2"], "x": [-1, 1] }
//   ```
//   :::
//
// The gloss escapes answer lines that start with `[` or `:::` with a backslash (D-134); inside a
// spec that backslash is taken off again, since the spec is read as data, never as structure.
import type { Text } from "@codemirror/state";
import { parseAttrs } from "../buffer/syntax";

/** One figure's spec in the buffer. */
export interface FigureBlock {
  /** Start of the opening fence line. */
  from: number;
  /** End of the closing fence line: the figure shows below it. */
  to: number;
  /** The spec between the fences. */
  source: string;
}

const OPEN = /^```\s*fnplot\s*$/;
const CLOSE = /^```\s*$/;
const DIV_OPEN = /^:::+\s*\{([^}]*)\}\s*$/;
const DIV_CLOSE = /^:::+\s*$/;
const ESCAPED = /^\\(?=\[|:::)/;

/** Whether `text` opens a gloss's fenced div. */
function glossOpen(text: string): boolean {
  const m = DIV_OPEN.exec(text);
  return m !== null && parseAttrs(`${m[1]}`).classes.includes("gloss");
}

/** Whether a line can change where figures are: a fence of a div or a code block. */
export function isFigureFence(text: string): boolean {
  return text.startsWith(":::") || text.startsWith("```");
}

/** The figure specs in `doc`, in order. A spec with no closing fence before its gloss ends is none. */
export function findFigures(doc: Text): FigureBlock[] {
  const out: FigureBlock[] = [];
  let inGloss = false;
  let open: { from: number; lines: string[] } | null = null;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = line.text;
    if (!inGloss) {
      inGloss = glossOpen(text);
    } else if (DIV_CLOSE.test(text)) {
      inGloss = false;
      open = null;
    } else if (open === null) {
      if (OPEN.test(text)) open = { from: line.from, lines: [] };
    } else if (CLOSE.test(text)) {
      out.push({ from: open.from, to: line.to, source: open.lines.join("\n") });
      open = null;
    } else {
      open.lines.push(text.replace(ESCAPED, ""));
    }
  }
  return out;
}
