// F6 / Shift-F6 (D-200): the focus moves to the next or previous pane: course rail, sidebar,
// editor, side panel, and round again. Tab on a line is "write for me" (10-keymap.md), so without
// this the editor would be a keyboard trap (WCAG 2.1.2). Panes that aren't there or are hidden
// (the sidebar after ␣e, the editor before a lecture opens) are skipped.
import { currentBuffer } from "./locate";

interface Pane {
  /** The pane's element. */
  root: string;
  /** Where the focus goes in it, the first that is there (the current row before the first). */
  targets: readonly string[];
}

const PANES: readonly Pane[] = [
  { root: ".course-rail", targets: ['[aria-current="true"]', "button:not([disabled])"] },
  {
    root: "#sidebar",
    targets: ['[aria-current="page"]', 'button:not([disabled]):not([aria-disabled="true"])', "[tabindex]"],
  },
  // The editor: the lecture buffer, which focuses itself (keys/vim.ts).
  { root: ".buffer", targets: [] },
  {
    root: ".side-panel",
    targets: ["input:not([disabled])", "textarea", "select", "button:not([disabled])", "[tabindex]"],
  },
];

/** Focuses pane `pane` in `doc`; whether it took the focus. */
function focusPane(doc: Document, pane: Pane): boolean {
  const root = doc.querySelector(pane.root);
  if (!root || root.closest("[hidden]")) return false;
  if (pane.targets.length === 0) {
    const buffer = currentBuffer();
    if (!buffer || !root.contains(buffer.root)) return false;
    buffer.focus();
    return true;
  }
  for (const selector of pane.targets) {
    const el = root.querySelector<HTMLElement>(selector);
    if (el && !el.closest("[hidden]")) {
      el.focus();
      return doc.activeElement === el;
    }
  }
  return false;
}

/**
 * Moves the focus `dir` panes on from the one that has it (from before the first when none does);
 * false when no other pane can take it.
 */
export function cyclePanes(doc: Document, dir: 1 | -1): boolean {
  const active = doc.activeElement;
  const at = PANES.findIndex((p) => doc.querySelector(p.root)?.contains(active) === true);
  const n = PANES.length;
  // With no pane focused, F6 starts at the first and Shift-F6 at the last.
  const start = at === -1 ? (dir === 1 ? n - 1 : 0) : at;
  for (let step = 1; step < n + (at === -1 ? 1 : 0); step++) {
    const pane = PANES[(((start + dir * step) % n) + n) % n] as Pane;
    if (focusPane(doc, pane)) return true;
  }
  return false;
}
