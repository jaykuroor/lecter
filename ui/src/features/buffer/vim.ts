// The Vim keys of 10-keymap.md#move-everywhere that move differently in a lecture: `j k` move by
// element and `gg G` go to the first and last element (`{count}` works as in Vim: `3j`, `5gg`).
// `i` and `Esc` are @replit/codemirror-vim's own. Vim's key table is global, so the motions check
// for the lecture buffer and move by plain lines in any other editor, and with an operator pending
// (`dj` stays linewise over the real lines).
import type { EditorState } from "@codemirror/state";
import { Facet } from "@codemirror/state";
import { Vim } from "@replit/codemirror-vim";
import { lastElement, nthElement, stepElements } from "./elements";
import { visibleRange } from "./syntax";

/** Marks an editor as a lecture buffer, where the element motions apply. */
export const lectureBuffer = Facet.define<boolean, boolean>({ combine: (values) => values.some(Boolean) });

/** A Vim position: 0-based line and column. */
interface Pos {
  line: number;
  ch: number;
}

/** The column where line `n`'s visible text starts (after a block's `[`). */
function startCh(state: EditorState, n: number): number {
  return visibleRange(state.doc, n).from - state.doc.line(n).from;
}

/**
 * `j`/`k` in a lecture: `count` elements down or up, keeping the column within the text.
 * `null` when there is no element that way (the cursor stays).
 */
function elementMove(state: EditorState, head: Pos, forward: boolean, count: number): Pos | null {
  const doc = state.doc;
  const from = head.line + 1;
  const to = stepElements(doc, from, forward ? 1 : -1, count);
  if (to === null) return null;
  const offset = Math.max(0, head.ch - startCh(state, from));
  const { from: start, to: end } = visibleRange(doc, to);
  const lineFrom = doc.line(to).from;
  // On the last character, not past it, as in Vim's normal mode.
  const last = Math.max(start, end - 1);
  return { line: to - 1, ch: Math.min(start + offset, last) - lineFrom };
}

/** `gg` (first element, or the `count`th with an explicit count) and `G` (last, or the `count`th). */
function elementEdge(state: EditorState, forward: boolean, count: number | null): Pos | null {
  const n = count !== null ? nthElement(state.doc, count) : forward ? lastElement(state.doc) : nthElement(state.doc, 1);
  return n === null ? null : { line: n - 1, ch: startCh(state, n) };
}

/** A plain Vim line move, for editors that aren't a lecture and for operators. */
function lineMove(state: EditorState, head: Pos, delta: number): Pos {
  const line = Math.min(Math.max(head.line + delta, 0), state.doc.lines - 1);
  return { line, ch: Math.min(head.ch, state.doc.line(line + 1).length) };
}

interface MotionCm {
  cm6: { state: EditorState };
}

type Motion = Parameters<typeof Vim.defineMotion>[1];

/** `j` and `k`: by element in a lecture; by plain lines elsewhere and with an operator pending. */
export const elementMotion: Motion = (cm, head, args, _vim, input) => {
  const state = (cm as unknown as MotionCm).cm6.state;
  const forward = args.forward === true;
  if (!state.facet(lectureBuffer) || input.operator) return lineMove(state, head, forward ? args.repeat : -args.repeat);
  return elementMove(state, head, forward, args.repeat) ?? head;
};

/** `gg` and `G`: the first, last or `{count}`th element in a lecture; plain lines elsewhere. */
export const edgeMotion: Motion = (cm, head, args) => {
  const state = (cm as unknown as MotionCm).cm6.state;
  const count = args.repeatIsExplicit ? args.repeat : null;
  if (!state.facet(lectureBuffer)) {
    const line = count !== null ? count - 1 : args.forward ? state.doc.lines - 1 : 0;
    return lineMove(state, { line: 0, ch: 0 }, line);
  }
  return elementEdge(state, args.forward === true, count) ?? head;
};

/** The keys of 10-keymap.md#move-everywhere these motions take over: keys, motion, its args. */
export const ELEMENT_KEYS: readonly (readonly [string, string, Record<string, boolean>])[] = [
  ["j", "lecterElement", { forward: true, linewise: true }],
  ["k", "lecterElement", { forward: false, linewise: true }],
  ["gg", "lecterEdge", { forward: false, explicitRepeat: true, linewise: true, toJumplist: true }],
  ["G", "lecterEdge", { forward: true, explicitRepeat: true, linewise: true, toJumplist: true }],
];

/** The parts of Vim's API registration uses: the real `Vim`, or a recording fake in tests. */
export interface VimApi {
  defineMotion(name: string, fn: Motion): void;
  mapCommand(keys: string, type: string, name: string, args: unknown, extra: Record<string, unknown>): void;
}

const registered = new WeakSet<VimApi>();

/** Maps `j k gg G` to the element motions, once per Vim API (once per page for the real one). */
export function registerElementMotions(api: VimApi = Vim): void {
  if (registered.has(api)) return;
  registered.add(api);
  api.defineMotion("lecterElement", elementMotion);
  api.defineMotion("lecterEdge", edgeMotion);
  for (const [keys, motion, args] of ELEMENT_KEYS) api.mapCommand(keys, "motion", motion, args, {});
}
