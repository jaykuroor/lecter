// `a` in normal mode (10-keymap.md#on-a-slide-line, F-048): Vim's append on an own-note line and
// in every other editor, but nothing on a slide line of a lecture buffer, where it used to ask
// (asking is Enter now, features/gloss/askKey.ts). Vim's key table is global (ui/CLAUDE.md), so the
// action checks the editor and the line itself.
import type { EditorView } from "@codemirror/view";
import { Vim } from "@replit/codemirror-vim";
import { blockSpan } from "../features/buffer/syntax";
import { lectureBuffer } from "../features/buffer/vim";

type ActionFn = Parameters<typeof Vim.defineAction>[1];
type Cm = Parameters<ActionFn>[0];

/** The parts of Vim's API registration uses: the real `Vim`, or a recording fake in tests. */
export interface AppendVimApi {
  defineAction(name: string, fn: ActionFn): void;
  mapCommand(keys: string, type: string, name: string, args: unknown, extra: Record<string, unknown>): void;
  handleKey(cm: Cm, key: string, origin: string): unknown;
}

/**
 * Vim's `a`: insert mode just after the cursor's character (at the line's end on an empty line).
 * Entered as `i` at the cursor, then moved one character on (insert mode may sit at the line's
 * end; normal mode may not). A count is passed on to `i`.
 */
function append(api: AppendVimApi, cm: Cm, view: EditorView, repeat: number): void {
  if (repeat > 1) for (const digit of String(repeat)) api.handleKey(cm, digit, "mapping");
  api.handleKey(cm, "i", "mapping");
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  const code = view.state.doc.sliceString(head, head + 1).charCodeAt(0);
  const step = code >= 0xd800 && code <= 0xdbff ? 2 : 1;
  view.dispatch({ selection: { anchor: Math.min(head + step, line.to) } });
}

/** The `a` action: nothing on a slide block of a lecture buffer, append anywhere else. */
function appendAction(api: AppendVimApi): ActionFn {
  return (cm, args) => {
    const view = (cm as unknown as { cm6: EditorView }).cm6;
    const state = view.state;
    if (state.facet(lectureBuffer) && blockSpan(state.doc.lineAt(state.selection.main.head).text)) return;
    append(api, cm, view, args.repeat ?? 1);
  };
}

const registered = new WeakSet<AppendVimApi>();

/** Maps `a` in normal mode to the append action, once per Vim API (once per page for the real one). */
export function registerAppendKey(api: AppendVimApi = Vim as unknown as AppendVimApi): void {
  if (registered.has(api)) return;
  registered.add(api);
  api.defineAction("lecterAppend", appendAction(api));
  api.mapCommand("a", "action", "lecterAppend", {}, { context: "normal" });
}
