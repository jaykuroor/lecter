// Where the cursor may be, and which line is focused (docs/design/components.md#block). The
// cursor stays on text that shows: inside a block's text (so typing after `i` lands in the span,
// not before its hidden `[`) and off hidden lines (any motion or click that lands on one moves on
// to the nearest element line). The focused line gets `cm-focused-line`: a block shows its focus
// background and cursor marker, and a blank line opens to full height while the cursor is on it.
import { EditorSelection, EditorState, type Extension, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { showingPos } from "./elements";

/** The selection after `tr` with every head moved onto showing text, or `null` when none moves. */
export function showingSelection(tr: Transaction): EditorSelection | null {
  const selection = tr.selection;
  if (!selection) return null;
  const doc = tr.newDoc;
  const before = tr.changes.mapPos(tr.startState.selection.main.head);
  let moved = false;
  const ranges = selection.ranges.map((r) => {
    const head = showingPos(doc, r.head, r.head < before ? -1 : 1);
    if (head === r.head) return r;
    moved = true;
    return r.empty ? EditorSelection.cursor(head) : EditorSelection.range(r.anchor, head);
  });
  return moved ? EditorSelection.create(ranges, selection.mainIndex) : null;
}

const keepShowing = EditorState.transactionFilter.of((tr) => {
  const selection = showingSelection(tr);
  return selection ? [tr, { selection, sequential: true }] : tr;
});

const focusedLine = Decoration.line({ class: "cm-focused-line" });

function focusDecorations(view: EditorView): DecorationSet {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  return Decoration.set([focusedLine.range(line.from)]);
}

const focus = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = focusDecorations(view);
    }
    update(u: ViewUpdate): void {
      if (u.selectionSet || u.docChanged) this.decorations = focusDecorations(u.view);
    }
  },
  { decorations: (p) => p.decorations },
);

/** The cursor rules and the focused-line decoration. */
export const cursorRules: Extension = [keepShowing, focus];
