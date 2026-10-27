// The figures of a lecture buffer (ui/CLAUDE.md: figures are widgets in the one buffer): a block
// widget under each function plot spec in a gloss. The set is rebuilt only when an edit touches a
// fence line or a spec; any other edit (typing in a note, a block) just maps it, so the keystroke
// path stays one pass over the changed lines.
import { type EditorState, type Extension, StateField, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { type FigureBlock, findFigures, isFigureFence } from "./find";
import { FigureWidget } from "./widget";

interface Figures {
  blocks: FigureBlock[];
  deco: DecorationSet;
}

function build(state: EditorState): Figures {
  const blocks = findFigures(state.doc);
  const deco = Decoration.set(
    blocks.map((b) => Decoration.widget({ widget: new FigureWidget(b.source), block: true, side: 1 }).range(b.to)),
  );
  return { blocks, deco };
}

/** Whether `tr` changes a fence line or a spec (before or after the edit). */
function touchesFigures(tr: Transaction, blocks: FigureBlock[]): boolean {
  let touched = false;
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (touched) return;
    touched = blocks.some((b) => fromA <= b.to && toA >= b.from);
    for (const [doc, from, to] of [
      [tr.startState.doc, fromA, toA],
      [tr.state.doc, fromB, toB],
    ] as const) {
      for (let n = doc.lineAt(from).number; !touched && n <= doc.lineAt(to).number; n++) {
        touched = isFigureFence(doc.line(n).text);
      }
    }
  });
  return touched;
}

const figuresField = StateField.define<Figures>({
  create: build,
  update(value, tr) {
    if (!tr.docChanged) return value;
    if (touchesFigures(tr, value.blocks)) return build(tr.state);
    const map = (pos: number, assoc: number) => tr.changes.mapPos(pos, assoc);
    return {
      blocks: value.blocks.map((b) => ({ ...b, from: map(b.from, 1), to: map(b.to, -1) })),
      deco: value.deco.map(tr.changes),
    };
  },
  provide: (field) => EditorView.decorations.from(field, (v) => v.deco),
});

/** Function plots drawn under their specs in glosses (F-024). */
export const figureExtension: Extension = figuresField;
