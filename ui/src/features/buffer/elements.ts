// Moving between the buffer's elements (10-keymap.md#move-everywhere: `j k` "line or element",
// `gg G` top/bottom). In a lecture the structure lines (front matter, `:::` fences, slide titles)
// are hidden and blank lines are gaps, so a move lands only on lines that show text: slide blocks,
// glosses' and notes' lines, the user's own lines. Pure functions over a CodeMirror `Text`.
import type { Text } from "@codemirror/state";
import { frontMatterEnd, isElement, isHidden, lineKind, visibleRange } from "./syntax";

/**
 * The element line `count` elements away from line `from` in direction `dir`, or the furthest one
 * there is when fewer exist. `null` when there is none in that direction.
 */
export function stepElements(doc: Text, from: number, dir: 1 | -1, count: number): number | null {
  const fm = frontMatterEnd(doc);
  let found: number | null = null;
  let left = Math.max(1, count);
  for (let n = from + dir; n >= 1 && n <= doc.lines && left > 0; n += dir) {
    if (isElement(lineKind(doc, n, fm))) {
      found = n;
      left--;
    }
  }
  return found;
}

/** The `nth` element line from the top (1-based), or the last one when there are fewer. */
export function nthElement(doc: Text, nth: number): number | null {
  return stepElements(doc, 0, 1, nth);
}

/** The last element line, or `null` when the buffer shows none. */
export function lastElement(doc: Text): number | null {
  return stepElements(doc, doc.lines + 1, -1, 1);
}

/**
 * A cursor position that shows: inside a block's text (not on its hidden `[` or `]{…}`), and not
 * on a hidden line. A position on a hidden line moves to the nearest element line in the
 * direction of travel (`dir`; 1 when the cursor moved down or didn't move), its text's start when
 * going down and its end when going up. Positions elsewhere are returned as they are.
 */
export function showingPos(doc: Text, pos: number, dir: 1 | -1): number {
  const line = doc.lineAt(pos);
  const kind = lineKind(doc, line.number, frontMatterEnd(doc));
  if (kind === "block") {
    const { from, to } = visibleRange(doc, line.number);
    return Math.min(Math.max(pos, from), to);
  }
  if (!isHidden(kind)) return pos;
  const ahead = stepElements(doc, line.number, dir, 1);
  const target = ahead ?? stepElements(doc, line.number, dir === 1 ? -1 : 1, 1);
  if (target === null) return pos;
  const range = visibleRange(doc, target);
  return (ahead !== null ? dir : -dir) === 1 ? range.from : range.to;
}
