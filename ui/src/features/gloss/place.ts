// Where a gloss goes in the lecture file (03-lecture-files.md#body): a fenced div right under the
// block or own note it explains, after the glosses and notes already anchored there, so its
// glosses read oldest first. Pure functions over a CodeMirror `Text`.
import type { Text } from "@codemirror/state";
import { enclosingDiv } from "../../keys/vim";
import { blockSpan, parseAttrs } from "../buffer/syntax";

const OPEN = /^:::+\s*\{([^}]*)\}\s*$/;
/** An own note's id as the core takes it (app/src/ipc/validate.rs: `n-[0-9a-f]{4,8}`). */
const NOTE_ID = /^n-[0-9a-f]{4,8}$/;

/** The id of the own note (`::: {.note #n-91c0}`) line `n` is in, or `null` when it is in none. */
export function noteAt(doc: Text, n: number): string | null {
  const div = enclosingDiv(doc, n);
  return div?.classes.includes("note") && NOTE_ID.test(div.id) ? div.id : null;
}

/**
 * The number of the line a gloss on `anchor` goes after: the line of block `anchor` (`s3b2`), or
 * the closing fence of own note `anchor` (`n-91c0`); `null` when the lecture has neither.
 */
export function anchorLine(doc: Text, anchor: string): number | null {
  const note = NOTE_ID.test(anchor);
  for (let n = 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    if (!note && blockSpan(text)?.id === anchor) return n;
    if (note && text.startsWith(":::")) {
      const m = OPEN.exec(text);
      const attrs = m?.[1] ? parseAttrs(m[1]) : null;
      if (attrs?.id === anchor && attrs.classes.includes("note")) return closingLine(doc, n);
    }
  }
  return null;
}

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
