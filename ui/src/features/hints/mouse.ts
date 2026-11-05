// The mouse way to each hint's action, which the full hint bar shows next to the key
// (09-ui.md#hint-bar-and-keystroke-overlay: for people who don't use Vim). The paths are the ones
// 09-ui.md gives: right-click any element for its menu, a gloss's keycap buttons, double-click to
// edit, the sidebar's Flags list and the right panel's Doubts tab, the course rail.
import type { Hint } from "./hints";

const BY_COMMAND: Readonly<Record<string, string>> = {
  "line.edit": "double-click",
  "gloss.edit": "double-click",
  "slide.next": "scroll",
  "slide.prev": "scroll",
  "gloss.next": "scroll",
  "gloss.prev": "scroll",
  "step.next": "scroll",
  "step.prev": "scroll",
  "flag.next": "Flags in the sidebar",
  "flag.prev": "Flags in the sidebar",
  "doubt.next": "Doubts tab",
  "doubt.prev": "Doubts tab",
  "course.go": "click the course",
  "focus.next": "click a pane",
  "focus.prev": "click a pane",
};

const BY_SCOPE: Readonly<Record<Hint["scope"], string>> = {
  line: "right-click the line",
  gloss: "click its keycap",
  buffer: "right-click",
  app: "click here",
  global: "click here",
};

/** What a mouse user does instead of the hint's keys. */
export function mouseAction(hint: Hint): string {
  return (hint.binding && BY_COMMAND[hint.binding.command]) || BY_SCOPE[hint.scope];
}
