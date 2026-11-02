// `a` (10-keymap.md#on-a-slide-line: "Ask about this line"). Slide lines are read-only in normal
// mode, so there `a` opens the prompt row; on any other line (own notes, gloss text) and in other
// editors it stays Vim's append. Vim's key table is global (ui/CLAUDE.md), so the action checks
// the editor and the line itself.
import type { EditorView } from "@codemirror/view";
import { Vim } from "@replit/codemirror-vim";
import { lectureBuffer } from "../buffer/vim";
import { openPrompt } from "./controller";

type ActionFn = Parameters<typeof Vim.defineAction>[1];
type Cm = Parameters<ActionFn>[0];

/** The parts of Vim's API registration uses: the real `Vim`, or a recording fake in tests. */
export interface AskVimApi {
  defineAction(name: string, fn: ActionFn): void;
  mapCommand(keys: string, type: string, name: string, args: unknown, extra: Record<string, unknown>): void;
  handleKey(cm: Cm, key: string, origin: string): unknown;
}

/**
 * Vim's `a`: insert mode just after the cursor's character (at the line's end on an empty line).
 * Entered as `i` at the cursor, then moved one character on (insert mode may sit at the line's
 * end; normal mode may not). A count is passed on to `i`.
 */
function append(api: AskVimApi, cm: Cm, view: EditorView, repeat: number): void {
  if (repeat > 1) for (const digit of String(repeat)) api.handleKey(cm, digit, "mapping");
  api.handleKey(cm, "i", "mapping");
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  const code = view.state.doc.sliceString(head, head + 1).charCodeAt(0);
  const step = code >= 0xd800 && code <= 0xdbff ? 2 : 1;
  view.dispatch({ selection: { anchor: Math.min(head + step, line.to) } });
}

/** The `a` action: ask on a slide block of a lecture buffer, append anywhere else. */
function askAction(api: AskVimApi): ActionFn {
  return (cm, args) => {
    const view = (cm as unknown as { cm6: EditorView }).cm6;
    const state = view.state;
    const line = state.doc.lineAt(state.selection.main.head);
    if (state.facet(lectureBuffer) && openPrompt(view, line.number)) return;
    append(api, cm, view, args.repeat ?? 1);
  };
}

const registered = new WeakSet<AskVimApi>();

/** Maps `a` in normal mode to the ask action, once per Vim API (once per page for the real one). */
export function registerAskKey(api: AskVimApi = Vim as unknown as AskVimApi): void {
  if (registered.has(api)) return;
  registered.add(api);
  api.defineAction("lecterAsk", askAction(api));
  api.mapCommand("a", "action", "lecterAsk", {}, { context: "normal" });
}
