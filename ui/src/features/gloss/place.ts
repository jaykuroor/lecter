// Where a gloss goes in the lecture file (03-lecture-files.md#body): a fenced div right under the
// block it explains, after the glosses and notes already anchored there, so a block's glosses read
// oldest first. Pure functions over a CodeMirror `Text`.
import type { Text } from "@codemirror/state";
import { blockSpan, parseAttrs } from "../buffer/syntax";

/** The number of the line holding block `id` (`s3b2`), or `null` when the lecture has none. */
export function blockLine(doc: Text, id: string): number | null {
  for (let n = 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    if (blockSpan(text)?.id === id) return n;
  }
  return null;
}

const OPEN = /^:::+\s*\{([^}]*)\}\s*$/;

/** Whether line `text` opens a gloss or note div anchored to block `anchor`. */
function anchoredOpen(text: string, anchor: string): boolean {
  const m = OPEN.exec(text);
  if (!m?.[1]) return false;
  const attrs = parseAttrs(m[1]);
  return (attrs.classes.includes("gloss") || attrs.classes.includes("note")) && attrs.values.anchor === anchor;
}

/** The line that closes the div opened on line `from`, counting nested divs; `null` if unclosed. */
function closingLine(doc: Text, from: number): number | null {
  let depth = 0;
  for (let n = from; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    if (OPEN.test(text)) depth++;
    else if (/^:::+\s*$/.test(text)) depth--;
    if (depth === 0) return n;
  }
  return null;
}

/**
 * The position to insert a new gloss for block `anchor`, whose line is `line`: the end of the
 * block's line, or of the last gloss or note div anchored to it that follows (blank lines between
 * them allowed). The caller inserts `"\n\n" + div` there.
 */
export function glossInsertPos(doc: Text, line: number, anchor: string): number {
  let end = doc.line(line).to;
  let n = line + 1;
  while (n <= doc.lines) {
    const text = doc.line(n).text;
    if (text.trim() === "") {
      n++;
      continue;
    }
    if (!anchoredOpen(text, anchor)) break;
    const close = closingLine(doc, n);
    if (close === null) break;
    end = doc.line(close).to;
    n = close + 1;
  }
  return end;
}
