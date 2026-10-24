// Throwaway lecture surface: one CodeMirror 6 buffer, Vim mode, KaTeX (MathML) and gloss widgets,
// over a synthetic 200-slide lecture. Exposes hooks on `window` for measure.mjs.
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { blockField } from "./blocks";
import { fixtureLecture } from "./fixture";
import { inlineMath } from "./math";
import { installProbe } from "./probe";
import "./style.css";

const slides = Number(new URLSearchParams(location.search).get("slides") ?? "200");
const doc = fixtureLecture(slides);

const view = new EditorView({
  parent: document.getElementById("app") as HTMLElement,
  state: EditorState.create({
    doc,
    extensions: [
      vim(),
      history(),
      drawSelection(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      EditorView.lineWrapping,
      blockField,
      inlineMath,
    ],
  }),
});

// `?sync=1`: flush CodeMirror's measure cycle and force style + layout at each event's end mark
// (see probe.ts). `measure` is CodeMirror's internal flush (the one its rAF runs); spike only.
const syncPass = new URLSearchParams(location.search).get("sync") === "1";
const internal = view as unknown as { measure: (flush?: boolean) => void };
installProbe(
  syncPass
    ? () => {
        internal.measure(true);
        void view.contentDOM.getBoundingClientRect().height;
        void document.body.offsetHeight;
      }
    : undefined,
);

const w = window as unknown as Record<string, unknown>;
w.__stats = () => ({ slides, chars: view.state.doc.length, lines: view.state.doc.lines });
/** Put the cursor at the start of slide `n`'s first block line and scroll it into view. */
w.__gotoSlide = (n: number) => {
  const d = view.state.doc;
  for (let i = 1; i <= d.lines; i++) {
    const line = d.line(i);
    if (line.text.startsWith(`[`) && line.text.includes(`{#s${n}b1`)) {
      view.dispatch({ selection: EditorSelection.cursor(line.from), scrollIntoView: true });
      view.focus();
      return i;
    }
  }
  return -1;
};
/** Scroll end to end in steps so every widget is rendered once (memory high-water mark). */
w.__scrollThrough = async () => {
  const s = view.scrollDOM;
  for (let y = 0; y < s.scrollHeight; y += s.clientHeight) {
    s.scrollTop = y;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
  s.scrollTop = 0;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
};

requestAnimationFrame(() =>
  new Promise<void>((r) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => r();
    ch.port2.postMessage(0);
  }).then(() => {
    w.__firstPaintMs = performance.now();
    w.__ready = true;
  }),
);
