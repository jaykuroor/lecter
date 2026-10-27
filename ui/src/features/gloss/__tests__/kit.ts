// Helpers for the gloss tests that drive a real lecture buffer with Vim keys (jsdom): the sample
// lecture, a fake core edge, a fake animation-frame clock and the keys and clicks a user makes.
import { EditorView } from "@codemirror/view";
import { getCM, Vim } from "@replit/codemirror-vim";
import { afterEach, beforeEach, vi } from "vitest";
import type { GlossBackend, GlossEvent } from "../../../core/gloss";
import type { Edit } from "../../../core/lecture";
import { lectureState } from "../../buffer/editorState";
import { registerAskKey } from "../askKey";

export const TEXT = [
  '::: {.slide #s1 n=1 title="Covariance"}',
  "## Covariance",
  "",
  "[Covariance measures co-movement.]{#s1b1}",
  "",
  "[It is zero for independent variables.]{#s1b2}",
  "",
  "my own note",
  "😀b",
  ":::",
  "",
].join("\n");

export const DIV =
  '::: {.gloss #g-0001 kind=ask key=a anchor=s1b1 model="sample" by=ai}\n**you asked:** why?\n\nBecause.\n:::';

/** A fake core edge: records asks and cancels; the test emits the stream's events. */
export function fakeBackend() {
  const asks: { block: string; question: string; emit: (e: GlossEvent) => void }[] = [];
  const cancels: string[] = [];
  let answer: (v: { ok: true; gloss: string }) => void = () => undefined;
  const backend: GlossBackend = {
    request: (block, question, emit) => {
      asks.push({ block, question, emit });
      return new Promise((r) => {
        answer = r;
      });
    },
    cancel: (gloss) => void cancels.push(gloss),
  };
  /** The core names the gloss (`gloss_request` returns). */
  const named = async (gloss = "g-0001") => {
    answer({ ok: true, gloss });
    await Promise.resolve();
  };
  return { asks, cancels, backend, named };
}

/** A fake animation-frame clock in place of the browser's. */
let frames: (() => void)[] = [];
export const frame = () => {
  const run = frames;
  frames = [];
  for (const cb of run) cb();
};

// CodeMirror measures text ranges in the frames these tests run; jsdom has no layout, so a range
// measures as nothing (otherwise CodeMirror logs a TypeError for each).
if (!("getClientRects" in Range.prototype)) {
  Object.assign(Range.prototype, {
    getClientRects: () => [],
    getBoundingClientRect: () => new DOMRect(),
  });
}

let views: EditorView[] = [];

/** Installs the fake frame clock and the `a` key before each test, and cleans up after it. */
export function useBuffer(): void {
  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => frames.push(cb));
    registerAskKey();
  });
  afterEach(() => {
    for (const v of views) v.destroy();
    views = [];
    vi.unstubAllGlobals();
  });
}

/** A lecture buffer on `text` whose asks go to `backend` and edits to `edits`. */
export function mount(backend: GlossBackend | null, edits: Edit[][] = [], text = TEXT) {
  const view = new EditorView({
    state: lectureState(text, "Lecture", (e) => edits.push(e), backend),
    parent: document.body,
  });
  views.push(view);
  return view;
}

/** Presses Vim keys one by one, as the user would. */
export function keys(view: EditorView, ...pressed: string[]) {
  const cm = getCM(view);
  if (!cm) throw new Error("no vim");
  for (const k of pressed) Vim.handleKey(cm, k, "user");
}

/** The (first) gloss card in the buffer. */
export const card = (view: EditorView) => view.dom.querySelector<HTMLElement>(".gloss");
/** The answer text the card shows. */
export const shown = (view: EditorView) => card(view)?.querySelector(".gloss-body")?.textContent ?? null;

/** Types `question` into the open prompt and presses `key` there. */
export function prompt(view: EditorView, question: string, key = "Enter") {
  const input = view.dom.querySelector<HTMLTextAreaElement>(".gloss-prompt-input");
  if (!input) throw new Error("no prompt");
  input.value = question;
  input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

/** Esc in the buffer. */
export function esc(view: EditorView) {
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
}
