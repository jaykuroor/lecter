// Where a key lands (10-keymap.md: bindings depend on the focused element): which element type the
// focus is, and in which mode. The lecture buffer tells its own (keys/vim.ts registers it once the
// editor's chunk is in); the rest goes by the DOM.
import type { Element as KeyElement } from "./engine";
import type { Mode } from "./keymap";

/** The lecture buffer, as the engine sees it. */
export interface BufferTarget {
  /** The buffer's DOM: keys aimed inside it are the buffer's. */
  root: Element;
  /** Vim's mode; `insert` covers replace mode, and Vim waiting for more keys (`d`, `f`, `"`). */
  mode(): Mode;
  /** The kind of line the cursor is on. */
  element(): "slide-line" | "note-line" | "gloss";
  /** Hands keys the engine held back to Vim, in order (`3`, `g`): Vim notation, which tokens are. */
  replay(tokens: readonly string[]): void;
}

let buffer: BufferTarget | null = null;

/** Registers the buffer (or none); returns the function that unregisters it. */
export function setBufferTarget(target: BufferTarget): () => void {
  buffer = target;
  return () => {
    if (buffer === target) buffer = null;
  };
}

/** Fields where keys type, wherever they are (the buffer's `:` and `/` prompts too). */
const TEXT_FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';
/** Elements Space and Enter already do something on: they activate them. */
const CONTROL = 'button, a[href], [role="button"]';

export interface Where {
  el: KeyElement;
  mode: Mode;
  /** Set when the key is aimed at the lecture buffer. */
  buffer: BufferTarget | null;
}

/** Where a key aimed at `target` lands. */
export function locate(target: EventTarget | null): Where {
  const el = target instanceof Element ? target : null;
  if (!el) return { el: "page", mode: "normal", buffer: null };
  if (buffer?.root.contains(el) && !el.closest("input, textarea, select")) {
    // In insert mode only the global keys apply, whatever the line: skip looking at it.
    const mode = buffer.mode();
    return { el: mode === "insert" ? "note-line" : buffer.element(), mode, buffer };
  }
  // The buffer before its chunk has registered it: Vim's mode as Buffer.tsx shows it.
  const host = el.closest(".lecture-buffer");
  if (host && !el.closest("input, textarea, select")) {
    const mode = host.getAttribute("data-vim-mode");
    if (mode === "normal" || mode === "visual") return { el: "page", mode, buffer: null };
    return { el: "field", mode: "insert", buffer: null };
  }
  if (el.closest(TEXT_FIELD)) return { el: "field", mode: "normal", buffer: null };
  if (el.closest(CONTROL)) return { el: "control", mode: "normal", buffer: null };
  return { el: "page", mode: "normal", buffer: null };
}
