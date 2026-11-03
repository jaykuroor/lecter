// F-180: the webview's own caret stops when the editor is idle (14-quality.md#performance-budgets,
// 09-ui.md#editing, D-161). The idle attribution showed the hidden native caret's blink was the
// whole idle redraw; a focused element that isn't contenteditable has no blinking caret. These
// tests run the real lecture buffer and check what the webview would see: whether .cm-content is
// editable, focused and focusable, and that every kind of input makes it editable again before
// CodeMirror and Vim act on it.
import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleLecture } from "../../../e2e/mock-core/lectures";
import type { Edit } from "../../core/lecture";
import { installTimeline, type Timeline } from "./__tests__/timeline";
import { BLINK_FOR_MS } from "./caret";
import { lectureState } from "./editorState";
import { nativeCaret, PARK_AFTER_MS, parked, WAKE } from "./nativeCaret";

let timeline: Timeline;
let view: EditorView;
/** The editor to destroy after the test, once one is open. */
let opened: EditorView | null = null;
let edits: Edit[][];

const editable = () => view.contentDOM.getAttribute("contenteditable");
const focused = () => document.activeElement === view.contentDOM && view.hasFocus;
const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);

function key(k: string): void {
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
}

/** Opens the sample lecture focused, and lets CodeMirror's 10 ms focus report run. */
async function open(): Promise<void> {
  edits = [];
  view = new EditorView({
    state: lectureState(sampleLecture, "Lecture l07.md", (e) => edits.push(e)),
    parent: document.body,
  });
  opened = view;
  view.focus();
  await wait(20);
}

beforeEach(() => {
  timeline = installTimeline();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "requestAnimationFrame"] });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  opened?.destroy();
  opened = null;
  timeline.uninstall();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the native caret", () => {
  it("parks a second before the drawn caret's 10 s blink ends", () => {
    expect(BLINK_FOR_MS).toBe(10_000);
    expect(PARK_AFTER_MS).toBe(9_000);
  });

  it("parks 9 s after the last key in normal mode: not editable, still focused and focusable, same cursor", async () => {
    await open();
    key("j");
    const head = view.state.selection.main.head;
    await wait(PARK_AFTER_MS - 1);
    expect(editable()).toBe("true");
    expect(view.state.field(parked)).toBe(false);
    await wait(1);
    expect(editable()).toBe("false");
    expect(view.state.field(parked)).toBe(true);
    expect(view.contentDOM.getAttribute("tabindex")).toBe("0");
    expect(focused()).toBe(true);
    expect(view.state.selection.main.head).toBe(head);
    // Parking is no edit: nothing goes to the core.
    expect(edits).toEqual([]);
    await wait(60_000);
    expect(editable()).toBe("false");
  });

  it("counts the 9 s from the last of several keys", async () => {
    await open();
    key("j");
    await wait(6_000);
    key("k");
    await wait(6_000);
    expect(editable()).toBe("true");
    await wait(PARK_AFTER_MS - 6_000);
    expect(editable()).toBe("false");
  });

  it("counts from a key that moves nothing (Esc in normal mode)", async () => {
    await open();
    key("j");
    await wait(6_000);
    key("Escape");
    await wait(PARK_AFTER_MS - 1);
    expect(editable()).toBe("true");
    await wait(1);
    expect(editable()).toBe("false");
  });

  it("doesn't count a document change that moves no cursor (a gloss arriving)", async () => {
    await open();
    key("j");
    await wait(5_000);
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\nMore text." } });
    await wait(PARK_AFTER_MS - 5_000);
    expect(editable()).toBe("false");
  });

  it("costs an awake editor's keys nothing: no transaction for a key that changes nothing", async () => {
    await open();
    const transactions: number[] = [];
    const listen = EditorView.updateListener.of((u) => transactions.push(u.transactions.length));
    view.dispatch({ effects: StateEffect.appendConfig.of(listen) });
    // The listener hears the transaction that added it.
    transactions.length = 0;
    key("Escape");
    expect(transactions.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("parks 9 s after the editor first gets the focus", async () => {
    edits = [];
    view = new EditorView({ state: lectureState(sampleLecture, "Lecture l07.md"), parent: document.body });
    opened = view;
    await wait(20_000);
    expect(editable()).toBe("true");
    view.focus();
    await wait(100);
    expect(editable()).toBe("true");
    await wait(PARK_AFTER_MS);
    expect(editable()).toBe("false");
  });

  it("parks 9 s after another lecture opens into the same focused editor", async () => {
    await open();
    await wait(5_000);
    view.setState(lectureState(sampleLecture, "Lecture l08.md"));
    expect(focused()).toBe(true);
    await wait(PARK_AFTER_MS - 1);
    expect(editable()).toBe("true");
    await wait(1);
    expect(editable()).toBe("false");
  });

  it("is editable again before CodeMirror and Vim see a key, and the key acts", async () => {
    await open();
    await wait(PARK_AFTER_MS);
    expect(editable()).toBe("false");
    const seen: (string | null)[] = [];
    const listener = () => seen.push(view.contentDOM.getAttribute("contenteditable"));
    view.contentDOM.addEventListener("keydown", listener);
    const before = view.state.selection.main.head;
    key("j");
    view.contentDOM.removeEventListener("keydown", listener);
    expect(seen).toEqual(["true"]);
    expect(view.state.selection.main.head).toBeGreaterThan(before);
    expect(focused()).toBe(true);
    // And it parks again 9 s after that key.
    await wait(PARK_AFTER_MS);
    expect(editable()).toBe("false");
  });

  it.each(WAKE)("wakes at a %s, before the editor's own handlers", async (type) => {
    expect(WAKE).toEqual(["keydown", "mousedown", "touchstart", "dragenter", "compositionstart"]);
    await open();
    await wait(PARK_AFTER_MS);
    expect(editable()).toBe("false");
    let during: string | null = null;
    view.contentDOM.addEventListener(type, () => {
      during = editable();
    });
    const init = { bubbles: true, cancelable: true };
    // Esc in normal mode: a key Vim takes and that moves nothing.
    const event =
      type === "keydown"
        ? new KeyboardEvent(type, { ...init, key: "Escape" })
        : type === "mousedown"
          ? new MouseEvent(type, { ...init, button: 0 })
          : new Event(type, init);
    // CodeMirror's touch observer reads the first touch.
    Object.defineProperty(event, "targetTouches", { value: [{ clientX: 1, clientY: 1 }] });
    view.contentDOM.dispatchEvent(event);
    expect(during).toBe("true");
    expect(editable()).toBe("true");
  });

  it("never parks in insert mode, and parks 9 s after Esc", async () => {
    await open();
    key("i");
    expect(getCM(view)?.state.vim?.insertMode).toBe(true);
    await wait(60_000);
    expect(editable()).toBe("true");
    key("Escape");
    expect(getCM(view)?.state.vim?.insertMode).toBe(false);
    await wait(PARK_AFTER_MS);
    expect(editable()).toBe("false");
  });

  it("parks in visual mode too", async () => {
    await open();
    key("v");
    expect(getCM(view)?.state.vim?.visualMode).toBe(true);
    await wait(PARK_AFTER_MS);
    expect(editable()).toBe("false");
  });

  it("doesn't park without the focus, and parks 9 s after it comes back", async () => {
    await open();
    view.contentDOM.blur();
    await wait(20);
    expect(view.hasFocus).toBe(false);
    await wait(60_000);
    expect(editable()).toBe("true");
    view.focus();
    // CodeMirror reports the focus a few ms after the DOM event; the count starts at its report.
    await wait(100);
    expect(editable()).toBe("true");
    await wait(PARK_AFTER_MS);
    expect(editable()).toBe("false");
    expect(focused()).toBe(true);
  });

  it("parks 9 s after the cursor moves, as a key or click would count it", async () => {
    await open();
    await wait(5_000);
    view.dispatch({ selection: { anchor: 10 } });
    await wait(PARK_AFTER_MS - 1);
    expect(editable()).toBe("true");
    await wait(1);
    expect(editable()).toBe("false");
  });

  it("stops listening once the editor is gone: a key on its old element wakes nothing", async () => {
    await open();
    await wait(PARK_AFTER_MS);
    expect(view.state.field(parked)).toBe(true);
    view.destroy();
    key("j");
    expect(view.state.field(parked)).toBe(true);
  });

  it("stops counting once the editor is gone: a pending count never parks it", async () => {
    await open();
    key("j");
    await wait(1_000);
    view.destroy();
    // Even were it still focused, the count it had running is gone.
    Object.defineProperty(view, "hasFocus", { get: () => true });
    await wait(60_000);
    expect(view.state.field(parked)).toBe(false);
  });

  it("parks an editor without Vim too", async () => {
    view = new EditorView({
      state: EditorState.create({ doc: "plain text", extensions: [nativeCaret] }),
      parent: document.body,
    });
    opened = view;
    view.focus();
    await wait(20);
    await wait(PARK_AFTER_MS);
    expect(editable()).toBe("false");
    expect(focused()).toBe(true);
  });

  it("keeps the text cursor over the editor and turns Chromium's own blink off", async () => {
    await open();
    const rules = [...document.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
    expect(rules).toMatch(/\.cm-content \{[^}]*cursor: text;[^}]*caret-animation: manual;?[^}]*\}/);
  });
});
