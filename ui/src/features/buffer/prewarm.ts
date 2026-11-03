// Editor pre-warm (app/CLAUDE.md: "pre-warm happens after paint"; cold_open_ms,
// 14-quality.md#performance-budgets). The first lecture buffer of a session runs CodeMirror's
// code, the lecture decorations and Vim for the first time, which costs several times what a later
// open does. After the shell's first paint, one throwaway buffer over a small synthetic lecture,
// off screen and hidden from assistive tools, runs that code once and is removed after its first
// frame. Once per page.
import { EditorView } from "@codemirror/view";
import { lectureState } from "./editorState";

/** A small lecture with every kind of part the decorations draw. Synthetic, English only. */
const WARM_LECTURE = [
  "---",
  "lecter: 1",
  "lecture: 1",
  "title: Warm-up",
  "---",
  "",
  '::: {.slide #s1 n=1 src="A1" title="Expectation" .flag}',
  "## Expectation",
  "",
  "[The mean of a variable $E[X]=\\sum_x x\\,p(x)$ weights each value.]{#s1b1}",
  "",
  "[Linearity holds for any variables.]{#s1b2 .flag}",
  "",
  "::: {.gloss #g-0a1b kind=steps key=s anchor=s1b1 by=ai}",
  "**you asked:** why does it hold?",
  "",
  "1. Expand and collect terms.",
  ":::",
  "",
  "::: {.note #n-0001 anchor=s1b2}",
  "Check the worked example.",
  ":::",
  ":::",
  "",
].join("\n");

let warmed = false;

/**
 * Builds the throwaway buffer, unless one was built before on this page. It is gone after the
 * next frame and the task after it, so CodeMirror's first measure runs too.
 */
export function prewarmEditor(): void {
  if (warmed) return;
  warmed = true;
  const host = document.createElement("div");
  host.className = "buffer-prewarm";
  host.setAttribute("aria-hidden", "true");
  host.inert = true;
  // Laid out like a buffer, but off screen and never drawn.
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:600px;visibility:hidden;contain:strict";
  document.body.append(host);
  const view = new EditorView({ state: lectureState(WARM_LECTURE, "Warm-up"), parent: host });
  requestAnimationFrame(() =>
    setTimeout(() => {
      view.destroy();
      host.remove();
    }),
  );
}
