// The slide the buffer's cursor is in, for the status line (09-ui.md#layout). Loaded with the
// editor's chunk (only the buffer imports it), never at first paint. The slide and the count come
// from the slide heading the buffer shows (decorations.ts), so the two always agree.
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { lectureDecorations, SlideHeading } from "../buffer/decorations";
import { slideFence } from "../buffer/syntax";
import type { SlidePos } from "./labels";

/**
 * Lines looked at above the cursor for its slide's fence before walking the decorations instead:
 * a slide is rarely more than a few dozen lines, and the walk costs one step per decoration.
 */
export const MAX_SCAN = 2000;

/**
 * The last slide heading among the decorations touching `from`–`to`. Only the heading's own
 * replacement touches a slide fence's start; a fence-like line in the front matter is touched by
 * the front matter's, which is no heading.
 */
function lastHeading(state: EditorState, from: number, to: number): SlidePos | null {
  let found: SlidePos | null = null;
  state.field(lectureDecorations).between(from, to, (_from, _to, value) => {
    const widget = value.spec.widget;
    if (widget instanceof SlideHeading) found = { n: widget.heading.n, total: widget.heading.total };
  });
  return found;
}

/**
 * The slide the main cursor is in: the nearest slide fence at or above its line (a gloss's or a
 * note's fence in between doesn't count), numbered as its heading is. `null` above the first slide,
 * or in a state without the lecture's decorations.
 */
export function slideAt(state: EditorState): SlidePos | null {
  if (state.field(lectureDecorations, false) === undefined) return null;
  const doc = state.doc;
  const head = doc.lineAt(state.selection.main.head).number;
  const stop = Math.max(1, head - MAX_SCAN);
  for (let n = head; n >= stop; n--) {
    const line = doc.line(n);
    if (slideFence(line.text)) return lastHeading(state, line.from, line.from);
  }
  // A slide longer than the scan: the last heading above it, from every decoration before.
  return lastHeading(state, 0, doc.line(stop).from);
}

/** Reports the cursor's slide to `report` after every change of the text or the cursor. */
export function slideReport(report: (slide: SlidePos | null) => void): Extension {
  return EditorView.updateListener.of((update) => {
    if (update.docChanged || update.selectionSet) report(slideAt(update.state));
  });
}
