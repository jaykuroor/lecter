// The lecture buffer's side of the key engine (loaded with the editor's chunk, never at first
// paint). It trims @replit/codemirror-vim's key table to the Vim subset Lecter keeps
// (10-keymap.md#vim-subset-kept), and tells the engine Vim's mode and the kind of line the cursor
// is on (10-keymap.md: a slide line, an own-note line, a gloss).
import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { getCM, Vim } from "@replit/codemirror-vim";
import { blockSpan, parseAttrs } from "../features/buffer/syntax";
import type { BufferTarget } from "./locate";

/**
 * Vim's default keys that are not in the kept subset, as [keys, context] (context as Vim writes
 * it; none = every mode). The given-up keys (`s S q t T m ' \` = Tab Enter R H M L #`) are among
 * them; Tab has no Vim entry. Insert-mode keys are left alone: there keys type text.
 */
export const VIM_DROPPED: readonly (readonly [string, string?])[] = [
  ["<Space>"],
  ["<C-Space>"],
  ["<S-Space>"],
  ["<C-BS>"],
  ["<S-BS>"],
  ["<C-n>"],
  ["<C-p>"],
  ["g<Up>"],
  ["g<Down>"],
  ["s", "normal"],
  ["s", "visual"],
  ["S", "normal"],
  ["S", "visual"],
  ["<PageUp>"],
  ["<PageDown>"],
  ["<CR>", "normal"],
  ["H"],
  ["M"],
  ["L"],
  ["gj"],
  ["gk"],
  ["W"],
  ["E"],
  ["B"],
  ["ge"],
  ["gE"],
  ["{"],
  ["}"],
  ["("],
  [")"],
  ["<C-f>"],
  ["<C-b>"],
  ["g$"],
  ["g^"],
  ["g0"],
  ["+"],
  ["-"],
  ["_"],
  ["%"],
  ["F<character>"],
  ["t<character>"],
  ["T<character>"],
  ["'<register>"],
  ["`<register>"],
  ["]`"],
  ["[`"],
  ["]'"],
  ["['"],
  ["]p"],
  ["[p"],
  ["]<character>"],
  ["[<character>"],
  ["|"],
  ["="],
  ["g~"],
  ["gu"],
  ["gU"],
  ["gc"],
  ["gn"],
  ["gN"],
  ["gq"],
  ["gw"],
  ["g?"],
  ["X"],
  ["D", "normal"],
  ["D", "visual"],
  ["Y", "normal"],
  ["Y", "visual"],
  ["C", "normal"],
  ["C", "visual"],
  ["~", "normal"],
  ["~", "visual"],
  ["<C-i>"],
  ["<C-o>"],
  ["<C-e>"],
  ["<C-y>"],
  ["gi", "normal"],
  ["gI", "normal"],
  ["<C-v>"],
  ["<C-q>"],
  ["gv"],
  ["gJ"],
  ["@<register>"],
  ["q<register>"],
  ["R", "normal"],
  ["R", "visual"],
  ["U", "visual"],
  ["m<register>"],
  ['"<register>'],
  ["z."],
  ["z<CR>"],
  ["z-"],
  ["<C-a>"],
  ["<C-x>"],
  ["#"],
  ["g*"],
  ["g#"],
];

/** The parts of Vim's API the trim uses: the real `Vim`, or a recording fake in tests. */
export interface VimKeyApi {
  unmap(lhs: string, ctx?: string): unknown;
  mapCommand(keys: string, type: string, name: string, args: unknown, extra: Record<string, unknown>): void;
}

const trimmed = new WeakSet<VimKeyApi>();

/**
 * Drops every Vim key outside the kept subset, once per Vim API (Vim's table is global). Page Up
 * and Page Down keep scrolling a page, and the jump list moves to Alt-← / Alt-→
 * (10-keymap.md#move-everywhere), since Ctrl-o, Ctrl-f and Ctrl-b are gone.
 */
export function trimVimKeys(api: VimKeyApi = Vim as unknown as VimKeyApi): void {
  if (trimmed.has(api)) return;
  trimmed.add(api);
  for (const [keys, ctx] of VIM_DROPPED) api.unmap(keys, ctx);
  api.mapCommand("<PageDown>", "motion", "moveByPage", { forward: true }, {});
  api.mapCommand("<PageUp>", "motion", "moveByPage", { forward: false }, {});
  api.mapCommand("<A-Left>", "action", "jumpListWalk", { forward: false }, {});
  api.mapCommand("<A-Right>", "action", "jumpListWalk", { forward: true }, {});
}

/** The most lines `lineElement` looks up for the div a line is in (a slide is far shorter). */
const MAX_SCAN = 5000;

/**
 * What line `n` is to the keys: a slide block (`slide-line`), a line of a gloss (`gloss`, inside a
 * `::: {.gloss}` div, 03-lecture-files.md#body), or any other line (`note-line`: own notes and
 * text).
 */
export function lineElement(doc: Text, n: number): "slide-line" | "note-line" | "gloss" {
  if (blockSpan(doc.line(n).text)) return "slide-line";
  let depth = 0;
  for (let i = n; i >= 1 && i > n - MAX_SCAN; i--) {
    const text = doc.line(i).text;
    if (!text.startsWith(":::")) continue;
    // The line starts with `:::` (above): an opening fence has its attributes after the colons.
    const open = /\{([^}]*)\}/.exec(text);
    if (!open) {
      // A closing fence: the div it closes is not around line n (unless it is line n itself).
      if (i !== n) depth++;
      continue;
    }
    if (depth > 0) {
      depth--;
      continue;
    }
    return parseAttrs(open[1] as string).classes.includes("gloss") ? "gloss" : "note-line";
  }
  return "note-line";
}

interface VimState {
  insertMode?: boolean;
  visualMode?: boolean;
  inputState: { keyBuffer: string[]; operator?: string | null };
}

/** The buffer `view` (its DOM `root`) as the engine sees it. */
export function bufferTarget(view: EditorView, root: Element): BufferTarget {
  const vim = () => (getCM(view)?.state as { vim?: VimState } | undefined)?.vim;
  return {
    root,
    mode: () => {
      const v = vim();
      if (!v) return "normal";
      // Vim in the middle of a command (`d`, `f`, `2d`) gets the next key as it is.
      const input = v.inputState;
      const busy = input.keyBuffer.length > 0 || !!input.operator;
      if (v.insertMode || busy) return "insert";
      return v.visualMode ? "visual" : "normal";
    },
    element: () => {
      const state = view.state;
      return lineElement(state.doc, state.doc.lineAt(state.selection.main.head).number);
    },
    focus: () => view.focus(),
    replay: (tokens) => {
      const cm = getCM(view);
      if (cm) for (const t of tokens) Vim.handleKey(cm, t, "user");
    },
  };
}
