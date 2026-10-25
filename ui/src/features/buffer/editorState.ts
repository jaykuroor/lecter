// The lecture buffer's CodeMirror state: one buffer for the whole lecture file (D-080), with Vim
// keys, the lecture's decorations and the cursor rules.
import { history } from "@codemirror/commands";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { cursorRules } from "./cursor";
import { lectureDecorations } from "./decorations";
import { nthElement } from "./elements";
import { visibleRange } from "./syntax";
import { lectureBuffer } from "./vim";

/** The editor extensions of a lecture buffer labelled `label` for assistive tools. */
function extensions(label: string): Extension {
  return [
    // First, so Vim sees keys before any other keymap.
    vim(),
    lectureBuffer.of(true),
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ "aria-label": label }),
    lectureDecorations,
    cursorRules,
  ];
}

/** A buffer state for the lecture file `text`, with the cursor on its first element. */
export function lectureState(text: string, label: string): EditorState {
  const doc = EditorState.create({ doc: text }).doc;
  const first = nthElement(doc, 1);
  const anchor = first === null ? 0 : visibleRange(doc, first).from;
  return EditorState.create({ doc, selection: EditorSelection.cursor(anchor), extensions: extensions(label) });
}
