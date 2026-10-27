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
import { type AskVimApi, registerAskKey } from "./askKey";
import { cardsField } from "./field";

const TEXT = [
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

describe("cards in the buffer", () => {
  it("a again replaces an open prompt with a fresh one", () => {
    const view = mount(fakeBackend().backend);
    keys(view, "a");
    const first = view.dom.querySelector<HTMLTextAreaElement>(".gloss-prompt-input");
    if (first) first.value = "old";
    keys(view, "a");
    const inputs = view.dom.querySelectorAll<HTMLTextAreaElement>(".gloss-prompt-input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.value).toBe("");
    expect(document.activeElement).toBe(inputs[0]);
  });

  it("keeps a streaming card when a prompt opens above it, and in order", () => {
    const f = fakeBackend();
    const view = mount(f.backend);
    view.dispatch({ selection: { anchor: view.state.doc.line(6).from + 1 } });
    keys(view, "a");
    prompt(view, "first?");
    view.dispatch({ selection: { anchor: view.state.doc.line(4).from + 1 } });
    keys(view, "a");
    const anchors = () =>
      Array.from(view.dom.querySelectorAll<HTMLElement>(".gloss"), (c) => `${c.dataset.anchor}:${c.dataset.state}`);
    expect(anchors()).toEqual(["s1b1:prompt", "s1b2:streaming"]);
    prompt(view, "never mind", "Escape");
    expect(anchors()).toEqual(["s1b2:streaming"]);
    expect(document.activeElement).toBe(view.contentDOM);
  });

  it("the Stop keycap stops the stream and tells the core", async () => {
    const f = fakeBackend();
    const view = mount(f.backend);
    keys(view, "a");
    prompt(view, "why?");
    await f.named("g-0042");
    view.dom.querySelector<HTMLButtonElement>(".gloss-stop")?.click();
    expect(card(view)?.dataset.state).toBe("stopped");
    expect(f.cancels).toEqual(["g-0042"]);
  });

  it("shows the card as a block under the line and keeps it under its block while the text above changes", () => {
    const view = mount(fakeBackend().backend);
    const empty = view.state.field(cardsField);
    view.dispatch({ changes: { from: 0, insert: "% a comment\n" } });
    expect(view.state.field(cardsField)).toBe(empty);
    view.dispatch({ selection: { anchor: view.state.doc.line(7).from + 1 } });
    keys(view, "a");
    expect(card(view)?.parentElement).toBe(view.contentDOM);
    view.dispatch({ changes: { from: 0, insert: "% another\n" } });
    expect(view.state.field(cardsField).map((p) => p.pos)).toEqual([view.state.doc.line(8).to]);
  });

  it("keys typed on the card's buttons never reach Vim", () => {
    const view = mount(fakeBackend().backend);
    keys(view, "a");
    prompt(view, "why?");
    const stop = view.dom.querySelector<HTMLButtonElement>(".gloss-stop");
    stop?.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true }));
    stop?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toBe(TEXT);
    expect(card(view)?.dataset.state).toBe("streaming");
  });

  it("an answer whose block was deleted meanwhile isn't saved, and says so", () => {
    const f = fakeBackend();
    const view = mount(f.backend);
    keys(view, "a");
    prompt(view, "why?");
    const line = view.state.doc.line(4);
    view.dispatch({ changes: { from: line.from, to: line.to + 1 } });
    const after = view.state.doc.toString();
    f.asks[0]?.emit({ event: "done", data: { markdown: DIV } });
    expect(view.state.doc.toString()).toBe(after);
    expect(card(view)?.dataset.state).toBe("failed");
    expect(card(view)?.querySelector("[role=alert]")?.textContent).toBe(
      "The line was deleted, so the answer was not saved.",
    );
  });
});

describe("a in Vim's other modes and with a count", () => {
  it("passes a count on to the insert, and steps over a two-unit character", () => {
    const view = mount(fakeBackend().backend);
    view.dispatch({ selection: { anchor: view.state.doc.line(8).from } });
    keys(view, "3", "a");
    expect(getCM(view)?.state.vim?.insertModeRepeat).toBe(3);
    keys(view, "<Esc>");
    const emoji = view.state.doc.line(9).from;
    view.dispatch({ selection: { anchor: emoji } });
    keys(view, "a");
    expect(view.state.selection.main.head).toBe(emoji + 2);
    expect(getCM(view)?.state.vim?.insertModeRepeat).toBe(1);
  });

  it("leaves visual mode's a (vaw selects a word)", () => {
    const view = mount(fakeBackend().backend);
    const from = view.state.doc.line(8).from;
    view.dispatch({ selection: { anchor: from } });
    keys(view, "v", "a", "w");
    const vim = getCM(view)?.state.vim;
    expect([vim?.visualMode, vim?.insertMode]).toEqual([true, false]);
    expect(card(view)).toBeNull();
    const sel = view.state.selection.main;
    expect(view.state.sliceDoc(sel.from, sel.to)).toBe("my ");
  });

  it("is registered once per Vim, as a normal-mode action", () => {
    const calls: unknown[][] = [];
    const api: AskVimApi = {
      defineAction: (name) => void calls.push(["defineAction", name]),
      mapCommand: (...args) => void calls.push(["mapCommand", ...args]),
      handleKey: () => undefined,
    };
    registerAskKey(api);
    registerAskKey(api);
    expect(calls).toEqual([
      ["defineAction", "lecterAsk"],
      ["mapCommand", "a", "action", "lecterAsk", {}, { context: "normal" }],
    ]);
  });
});

describe("the core's answers to gloss_request", () => {
  type Invoke = (cmd: string, args?: unknown) => Promise<unknown>;
  const internals = () => (window as unknown as { __TAURI_INTERNALS__: { invoke: Invoke } }).__TAURI_INTERNALS__;

  function failWith(reason: unknown) {
    installMockCore(defaultFixture);
    vi.unstubAllGlobals();
    const real = internals().invoke;
    internals().invoke = (cmd, args) => (cmd === "gloss_request" ? Promise.reject(reason) : real(cmd, args));
  }

  it("an error from the core shows its message", async () => {
    failWith({ code: "E_NOT_FOUND", message: "That line is no longer in the lecture.", retryable: false });
    const view = mount(glossBackend("/courses/STAT311", "lectures/l07.md"));
    keys(view, "a");
    prompt(view, "why?");
    await vi.waitFor(() => expect(card(view)?.dataset.state).toBe("failed"));
    expect(card(view)?.querySelector("[role=alert]")?.textContent).toBe("That line is no longer in the lecture.");
  });

  it("a core that can't be reached says so", async () => {
    failWith(new Error("gone"));
    const view = mount(glossBackend("/courses/STAT311", "lectures/l07.md"));
    keys(view, "a");
    prompt(view, "why?");
    await vi.waitFor(() => expect(card(view)?.dataset.state).toBe("failed"));
    expect(card(view)?.querySelector("[role=alert]")?.textContent).toBe("Lecter could not reach the core to ask.");
  });

  it("Esc reaches the core, which stops the stream and returns the answer so far", async () => {
    // The second delta would come a minute later: Esc lands between the two.
    installMockCore({ ...defaultFixture, gloss: { deltas: ["Be", " never sent."], deltaMs: 60_000 } });
    vi.unstubAllGlobals();
    const view = mount(glossBackend("/courses/STAT311", "lectures/l07.md"));
    keys(view, "a");
    prompt(view, "why?");
    await vi.waitFor(() => expect(card(view)?.querySelector(".gloss-body")?.textContent).toBe("Be"));
    esc(view);
    await vi.waitFor(() => expect(card(view)).toBeNull());
    expect(view.state.doc.toString()).toContain(`{#s1b1}\n\n${DIV.replace("Because.", "Be")}\n`);
  });
});
