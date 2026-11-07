// Enter asks (10-keymap.md#on-a-slide-line: "Ask about this line"; 06-ai-harness.md#roles-built-in-defaults,
// F-048). The key engine binds Enter to `ai.ask` on slide lines and own-note lines alike
// (keys/keymap.ts); while a lecture buffer that can ask is on screen, this runs it: the prompt row
// opens under the cursor's line, anchored to its slide block or its own note. Anywhere else (a
// line in no note, a buffer that can't ask) the command declines, and Enter does nothing there.
// `a` no longer asks (keys/append.ts).
import type { Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";
import { registerCommand } from "../../keys/commands";

/** The key engine's command for ask (keys/keymap.ts). */
export const ASK_COMMAND = "ai.ask";

/** Opens the prompt row for line `n` of `view`; whether it did (controller.ts `openPrompt`). */
export type OpenPrompt = (view: EditorView, n: number) => boolean;

/**
 * Asks on the cursor's line of `view`; whether a prompt opened. A selection (visual mode) is
 * declined: asking about a selection (`v…Enter`) is F-103's.
 */
export function askAtCursor(view: EditorView, open: OpenPrompt): boolean {
  const vim = getCM(view)?.state.vim as { visualMode?: boolean } | undefined;
  if (vim?.visualMode) return false;
  return open(view, view.state.doc.lineAt(view.state.selection.main.head).number);
}

/** Runs `ai.ask` on this buffer for as long as it is on screen (one buffer at a time). */
export function askCommand(open: OpenPrompt): Extension {
  return ViewPlugin.define((view) => {
    const drop = registerCommand(ASK_COMMAND, () => askAtCursor(view, open));
    return { destroy: drop };
  });
}
