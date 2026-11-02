// The caret blinks for 10 s after the last key or click, then stays solid until the next one
// (09-ui.md#editing, 14-quality.md#performance-budgets, D-146). jsdom has no animation engine, so
// these tests run the real lecture buffer on a fake Web Animations timeline (__tests__/timeline.ts)
// and ask what would show: is the caret animating, and is it visible.
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleLecture } from "../../../e2e/mock-core/lectures";
import { installTimeline, type Timeline } from "./__tests__/timeline";
import { BLINK_FOR_MS } from "./caret";
import { lectureState } from "./editorState";

let timeline: Timeline;
let view: EditorView;
/** The editor to destroy after the test, once one is open. */
let opened: EditorView | null = null;

/** CodeMirror's caret layers: its own (insert mode) and Vim's block cursor (normal mode). */
function layers(): HTMLElement[] {
  return [...view.scrollDOM.querySelectorAll<HTMLElement>(":scope > .cm-cursorLayer")];
}

/** How many caret layers are animating now. */
const blinking = () => layers().filter((l) => timeline.running(l) > 0).length;

/** The opacity each caret layer shows now. */
const opacities = () => layers().map((l) => timeline.opacity(l));

/** A key as the webview delivers it: a keydown on the focused editor. */
function key(k: string): void {
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
}

/** A mouse button pressed on the text: 0 the main button, 2 the one that opens the context menu. */
function click(button = 0): void {
  view.contentDOM.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button }));
}

/** Sets what `(prefers-reduced-motion: reduce)` answers. */
function reducedMotion(reduce: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query === "(prefers-reduced-motion: reduce)",
    media: query,
    // CodeMirror listens to its print query.
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

/** CodeMirror reports a focus change 10 ms after the DOM event; waits that out. */
const focusSettles = () => new Promise((resolve) => setTimeout(resolve, 20));

function open(): void {
  view = new EditorView({ state: lectureState(sampleLecture, "Lecture l07.md"), parent: document.body });
  opened = view;
  view.focus();
}

beforeEach(() => {
  timeline = installTimeline();
  reducedMotion(false);
});

afterEach(() => {
  opened?.destroy();
  opened = null;
  timeline.uninstall();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the caret", () => {
  it("is the 10 s of GTK's blink timeout", () => {
    expect(BLINK_FOR_MS).toBe(10_000);
  });

  it("blinks after a key: shown for the first half of each 1.2 s cycle, hidden for the second", () => {
    open();
    key("j");
    expect(layers()).toHaveLength(2);
    expect(blinking()).toBe(2);
    timeline.advance(300);
    expect(opacities()).toEqual([1, 1]);
    timeline.advance(600); // 0.9 s
    expect(opacities()).toEqual([0, 0]);
    timeline.advance(600); // 1.5 s: the next cycle
    expect(opacities()).toEqual([1, 1]);
    timeline.advance(600); // 2.1 s
    expect(opacities()).toEqual([0, 0]);
  });

  it("stops blinking 10 s after the last key and stays visible", () => {
    open();
    key("j");
    timeline.advance(BLINK_FOR_MS - 1);
    expect(blinking()).toBe(2);
    timeline.advance(1);
    expect(blinking()).toBe(0);
    expect(timeline.running()).toBe(0);
    expect(opacities()).toEqual([1, 1]);
    timeline.advance(60_000);
    expect(timeline.running()).toBe(0);
    expect(opacities()).toEqual([1, 1]);
  });

  it("counts the 10 s from the last of several keys", () => {
    open();
    key("j");
    timeline.advance(6_000);
    key("k");
    timeline.advance(6_000); // 12 s after the first key, 6 s after the last
    expect(blinking()).toBe(2);
    timeline.advance(BLINK_FOR_MS - 6_000);
    expect(blinking()).toBe(0);
  });

  it("blinks again at the next key, even one that moves nothing, for another 10 s", () => {
    open();
    key("j");
    timeline.advance(15_000);
    expect(blinking()).toBe(0);
    const head = view.state.selection.main.head;
    key("Escape"); // normal mode already: no transaction, no cursor move
    expect(view.state.selection.main.head).toBe(head);
    expect(blinking()).toBe(2);
    timeline.advance(900);
    expect(opacities()).toEqual([0, 0]);
    timeline.advance(BLINK_FOR_MS - 901);
    expect(blinking()).toBe(2);
    timeline.advance(1);
    expect(blinking()).toBe(0);
  });

  it("blinks again at the next click", () => {
    open();
    key("j");
    timeline.advance(15_000);
    expect(blinking()).toBe(0);
    click();
    expect(blinking()).toBe(2);
    timeline.advance(BLINK_FOR_MS);
    expect(blinking()).toBe(0);
  });

  it("blinks again at a click that moves nothing (the context-menu button)", () => {
    open();
    key("j");
    timeline.advance(15_000);
    const selection = view.state.selection;
    click(2); // CodeMirror selects nothing for it, so no transaction restarts the blink
    expect(view.state.selection.eq(selection)).toBe(true);
    expect(blinking()).toBe(2);
  });

  it("blinks in another lecture opened into the same focused editor", async () => {
    open();
    await focusSettles();
    timeline.advance(15_000);
    view.setState(lectureState(sampleLecture, "Lecture l08.md"));
    expect(view.hasFocus).toBe(true);
    expect(blinking()).toBe(2);
  });

  it("leaves nothing running once the editor is gone", () => {
    open();
    key("j");
    view.destroy();
    opened = null;
    expect(timeline.running()).toBe(0);
  });

  it("restarts the cycle when the cursor moves, so it shows at its new place", () => {
    open();
    key("j");
    timeline.advance(900); // hidden half
    expect(opacities()).toEqual([0, 0]);
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(16).from + 2) });
    expect(opacities()).toEqual([1, 1]);
  });

  it("blinks once the lecture opens focused, and stops 10 s later", async () => {
    open();
    await focusSettles();
    expect(blinking()).toBe(2);
    timeline.advance(BLINK_FOR_MS);
    expect(blinking()).toBe(0);
  });

  it("doesn't blink while the editor has no focus, and blinks again when it gets it back", async () => {
    open();
    await focusSettles();
    view.contentDOM.blur();
    expect(view.hasFocus).toBe(false);
    await focusSettles();
    expect(blinking()).toBe(0);
    timeline.advance(1_000);
    expect(blinking()).toBe(0);
    view.focus();
    await focusSettles();
    expect(blinking()).toBe(2);
  });

  it("keeps blinking through document changes, but they don't extend the 10 s", () => {
    open();
    key("j");
    // A gloss streaming in: text arrives with no key, click or cursor move of the user's.
    for (let t = 1_000; t <= 20_000; t += 1_000) {
      timeline.advance(1_000);
      view.dispatch({ changes: { from: view.state.doc.length, insert: "x" } });
      expect(blinking()).toBe(t < BLINK_FOR_MS ? 2 : 0);
    }
  });

  it("stays solid under reduced motion", () => {
    reducedMotion(true);
    open();
    key("j");
    expect(timeline.created()).toBe(0);
    expect(blinking()).toBe(0);
    expect(opacities()).toEqual([1, 1]);
  });

  it("reuses one animation per layer rather than making one per key", () => {
    open();
    for (let i = 0; i < 20; i++) key(i % 2 ? "j" : "k");
    expect(timeline.created()).toBe(2);
  });

  it("leaves CodeMirror's endless CSS blink off", () => {
    open();
    const rules = [...document.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
    expect(rules).toMatch(/> \.cm-scroller > \.cm-cursorLayer \{\s*animation: none !important;?\s*\}/);
  });
});

describe("an idle lecture", () => {
  it("runs no timer, no frame and no DOM change once the caret is solid", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "requestAnimationFrame"] });
    open();
    key("j");
    await vi.advanceTimersByTimeAsync(BLINK_FOR_MS);
    timeline.advance(BLINK_FOR_MS);
    expect(vi.getTimerCount()).toBe(0);
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    const frames = vi.fn();
    const raf = window.requestAnimationFrame;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames();
      return raf(cb);
    });
    await vi.advanceTimersByTimeAsync(30_000);
    timeline.advance(30_000);
    observer.disconnect();
    expect(mutations).toHaveLength(0);
    expect(frames).not.toHaveBeenCalled();
    expect(timeline.running()).toBe(0);
  });
});
