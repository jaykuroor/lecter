// F-023 criteria 2-4 in the buffer: `a` on a block opens the prompt, Enter streams the answer under
// the block (drawn once per animation frame), the finished gloss is inserted into the lecture as
// its fenced div (an edit like any other), and Esc stops the stream at once.
import { EditorView } from "@codemirror/view";
import { getCM, Vim } from "@replit/codemirror-vim";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultFixture } from "../../../e2e/mock-core/fixture";
import { installMockCore } from "../../../e2e/mock-core/install";
import { type GlossBackend, type GlossEvent, glossBackend } from "../../core/gloss";
import type { Edit } from "../../core/lecture";
import { lectureState } from "../buffer/editorState";
import { registerAskKey } from "./askKey";

const TEXT = [
  '::: {.slide #s1 n=1 title="Covariance"}',
  "## Covariance",
  "",
  "[Covariance measures co-movement.]{#s1b1}",
  "",
  "[It is zero for independent variables.]{#s1b2}",
  "",
  "my own note",
  ":::",
  "",
].join("\n");

const DIV =
  '::: {.gloss #g-0001 kind=ask key=a anchor=s1b1 model="sample" by=ai}\n**you asked:** why?\n\nBecause.\n:::';

/** A fake core edge: records asks and cancels; the test emits the stream's events. */
function fakeBackend() {
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
const frame = () => {
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
beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", (h: number) => {
    frames.splice(h - 1, 1, () => undefined);
  });
  registerAskKey();
});
afterEach(() => {
  for (const v of views) v.destroy();
  views = [];
  vi.unstubAllGlobals();
});

function mount(backend: GlossBackend | null, edits: Edit[][] = []) {
  const view = new EditorView({
    state: lectureState(TEXT, "Lecture", (e) => edits.push(e), backend),
    parent: document.body,
  });
  views.push(view);
  return view;
}

function keys(view: EditorView, ...pressed: string[]) {
  const cm = getCM(view);
  if (!cm) throw new Error("no vim");
  for (const k of pressed) Vim.handleKey(cm, k, "user");
}

const card = (view: EditorView) => view.dom.querySelector<HTMLElement>(".gloss");
const shown = (view: EditorView) => card(view)?.querySelector(".gloss-body")?.textContent ?? null;

/** Types `question` into the open prompt and presses `key` there. */
function prompt(view: EditorView, question: string, key = "Enter") {
  const input = view.dom.querySelector<HTMLTextAreaElement>(".gloss-prompt-input");
  if (!input) throw new Error("no prompt");
  input.value = question;
  input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

function esc(view: EditorView) {
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
}

describe("asking about a block", () => {
  it("a on a block opens the prompt under it, focused", () => {
    const view = mount(fakeBackend().backend);
    keys(view, "a");
    expect(card(view)?.dataset.state).toBe("prompt");
    expect(card(view)?.dataset.anchor).toBe("s1b1");
    expect(document.activeElement?.className).toBe("gloss-prompt-input");
    expect(getCM(view)?.state.vim?.insertMode).toBe(false);
  });

  it("Enter sends the question about that block and streams the answer, one paint per frame", async () => {
    const f = fakeBackend();
    const view = mount(f.backend);
    // To the second block (`j` needs layout, which jsdom lacks).
    view.dispatch({ selection: { anchor: view.state.doc.line(6).from + 1 } });
    keys(view, "a");
    prompt(view, "  why is it zero?");
    expect(f.asks.map((a) => [a.block, a.question])).toEqual([["s1b2", "  why is it zero?"]]);
    expect(card(view)?.dataset.state).toBe("streaming");
    expect(card(view)?.querySelector(".gloss-question")?.textContent).toBe("why is it zero?");
    const emit = f.asks[0]?.emit ?? (() => undefined);
    emit({ event: "started", data: { gloss: "g-0001", model: "sample" } });
    expect(card(view)?.querySelector(".gloss-meta")?.textContent).toBe("sample");
    // Every paint of the answer is one appendData on its text node.
    const paints = vi.spyOn(Text.prototype, "appendData");
    emit({ event: "delta", data: { text: "Inde" } });
    emit({ event: "delta", data: { text: "pendent " } });
    expect(shown(view)).toBe("");
    frame();
    expect(shown(view)).toBe("Independent ");
    emit({ event: "delta", data: { text: "vari" } });
    emit({ event: "delta", data: { text: "ables." } });
    expect(shown(view)).toBe("Independent ");
    frame();
    expect(shown(view)).toBe("Independent variables.");
    expect(paints.mock.calls).toEqual([["Independent "], ["variables."]]);
    paints.mockRestore();
  });

  it("the finished gloss is inserted under its block as an edit, and the card goes", () => {
    const f = fakeBackend();
    const edits: Edit[][] = [];
    const view = mount(f.backend, edits);
    keys(view, "a");
    prompt(view, "why?");
    const emit = f.asks[0]?.emit ?? (() => undefined);
    emit({ event: "delta", data: { text: "Because." } });
    emit({ event: "done", data: { markdown: DIV } });
    const blockEnd = TEXT.indexOf("{#s1b1}") + "{#s1b1}".length;
    expect(view.state.doc.toString()).toBe(`${TEXT.slice(0, blockEnd)}\n\n${DIV}${TEXT.slice(blockEnd)}`);
    expect(edits).toEqual([[{ from: blockEnd, to: blockEnd, text: `\n\n${DIV}` }]]);
    expect(card(view)).toBeNull();
    // `u` takes it back out, as any edit.
    keys(view, "u");
    expect(view.state.doc.toString()).toBe(TEXT);
  });

  it("Shift-Enter doesn't send, an empty question doesn't send, and Esc closes the prompt", () => {
    const f = fakeBackend();
    const view = mount(f.backend);
    keys(view, "a");
    const input = view.dom.querySelector<HTMLTextAreaElement>(".gloss-prompt-input");
    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    prompt(view, "   ");
    expect(f.asks).toEqual([]);
    prompt(view, "never mind", "Escape");
    expect(card(view)).toBeNull();
    expect(f.asks).toEqual([]);
  });
});

describe("Esc while an answer streams", () => {
  it("stops drawing at once, tells the core, and saves what arrived", async () => {
    const f = fakeBackend();
    const view = mount(f.backend);
    keys(view, "a");
    prompt(view, "why?");
    await f.named();
    const emit = f.asks[0]?.emit ?? (() => undefined);
    emit({ event: "delta", data: { text: "Because" } });
    frame();
    emit({ event: "delta", data: { text: " late" } });
    esc(view);
    expect(f.cancels).toEqual(["g-0001"]);
    expect(card(view)?.dataset.state).toBe("stopped");
    frame();
    emit({ event: "delta", data: { text: " later" } });
    frame();
    expect(shown(view)).toBe("Because");
    emit({ event: "stopped", data: { markdown: DIV } });
    expect(view.state.doc.toString()).toContain(`{#s1b1}\n\n${DIV}\n`);
    expect(card(view)).toBeNull();
  });

  it("before the core has named the gloss, cancels it as soon as it does", async () => {
    const f = fakeBackend();
    const view = mount(f.backend);
    keys(view, "a");
    prompt(view, "why?");
    esc(view);
    expect(f.cancels).toEqual([]);
    await f.named("g-00ab");
    expect(f.cancels).toEqual(["g-00ab"]);
  });

  it("a stream stopped before any text leaves the lecture as it was", async () => {
    const f = fakeBackend();
    const view = mount(f.backend);
    keys(view, "a");
    prompt(view, "why?");
    await f.named();
    esc(view);
    f.asks[0]?.emit({ event: "stopped", data: { markdown: null } });
    expect(card(view)).toBeNull();
    expect(view.state.doc.toString()).toBe(TEXT);
  });

  it("a failed answer shows why, saves nothing, and Esc dismisses it", () => {
    const f = fakeBackend();
    const view = mount(f.backend);
    keys(view, "a");
    prompt(view, "why?");
    const error = { code: "E_PROVIDER" as const, message: "The AI provider failed.", retryable: false, detail: null };
    f.asks[0]?.emit({ event: "failed", data: { error } });
    expect(card(view)?.dataset.state).toBe("failed");
    expect(card(view)?.querySelector("[role=alert]")?.textContent).toBe("The AI provider failed.");
    esc(view);
    expect(card(view)).toBeNull();
    expect(view.state.doc.toString()).toBe(TEXT);
  });
});

describe("a elsewhere is Vim's append", () => {
  it("on an own line, enters insert mode after the cursor's character", () => {
    const view = mount(fakeBackend().backend);
    const from = view.state.doc.line(8).from;
    view.dispatch({ selection: { anchor: from } });
    keys(view, "a");
    expect(card(view)).toBeNull();
    expect(getCM(view)?.state.vim?.insertMode).toBe(true);
    expect(view.state.selection.main.head).toBe(from + 1);
  });

  it("on a block of a buffer that can't ask", () => {
    const view = mount(null);
    const head = view.state.selection.main.head;
    keys(view, "a");
    expect(card(view)).toBeNull();
    expect(getCM(view)?.state.vim?.insertMode).toBe(true);
    expect(view.state.selection.main.head).toBe(head + 1);
  });
});

describe("through the core's channel", () => {
  it("the mocked core's stream ends with the gloss saved under the block", async () => {
    installMockCore({ ...defaultFixture, gloss: { deltas: ["Be", "cause."], deltaMs: 0 } });
    vi.unstubAllGlobals();
    const view = mount(glossBackend("/courses/STAT311", "lectures/l07.md"));
    keys(view, "a");
    prompt(view, "why?");
    await vi.waitFor(() => expect(card(view)).toBeNull());
    expect(view.state.doc.toString()).toContain(`{#s1b1}\n\n${DIV}\n`);
  });
});
