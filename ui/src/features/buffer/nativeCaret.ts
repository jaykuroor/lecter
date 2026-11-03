// The webview's own caret, under CodeMirror's drawn one, stops too once the editor is idle
// (14-quality.md#performance-budgets, 09-ui.md#editing; F-180, D-161). CodeMirror hides the
// native caret with `caret-color: transparent`, but the engine still blinks it: every half cycle
// it repaints the caret's rect, and the webview composites a whole frame. With a lecture open and
// idle that was 2.9-4.4 % of a core on the CI runners (software rendering), all of it in that
// blink: the idle attribution measured ~0.05 % with the editor not editable or blurred.
//
// So 9 s after the last key, click, focus change or cursor move (PARK_AFTER_MS), in normal or
// visual mode, the editor "parks": its content stops being contenteditable while it keeps the
// focus (tabindex) and the selection. A focused element that isn't editable has no blinking caret in WebKit or
// Chromium. Any key, click, touch, drag or composition wakes it first: a capture listener on the
// editor makes it editable again before CodeMirror and Vim see the event. Insert mode never parks,
// so a first key after a pause still goes through the input method (an IME or dead key).
// Chromium (WebView2) also gets `caret-animation: manual`, which stops its blink in every mode.
import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";
import { BLINK_FOR_MS } from "./caret";

/**
 * The editor parks this long after the last input: a second before the drawn caret's blink ends
 * (caret.ts), so that parking's own one-off work (a transaction, an attribute change and the
 * measure frame CodeMirror runs after it) is over by the 10 s mark, from which nothing may run.
 * The native caret is invisible, so parking it early shows nothing.
 */
export const PARK_AFTER_MS = BLINK_FOR_MS - 1_000;

const setParked = StateEffect.define<boolean>();

/** Whether the editor is parked: focused, idle and not editable. */
export const parked = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => tr.effects.reduce((v, e) => (e.is(setParked) ? e.value : v), value),
  provide: (field) => EditorView.editable.from(field, (isParked) => !isParked),
});

/** The events that wake a parked editor: everything that can edit or move the caret. */
export const WAKE = ["keydown", "mousedown", "touchstart", "dragenter", "compositionstart"] as const;

class NativeCaret {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly wake = () => {
    if (this.view.state.field(parked)) this.view.dispatch({ effects: setParked.of(false) });
    this.arm();
  };

  constructor(private readonly view: EditorView) {
    for (const type of WAKE) view.dom.addEventListener(type, this.wake, true);
    this.arm();
  }

  update(update: ViewUpdate): void {
    // A cursor move counts from now; a focus change only starts a count when none is running (the
    // focus a key or click gave already counts from that input).
    if (update.selectionSet || (update.focusChanged && this.timer === undefined)) this.arm();
  }

  /** Parks the editor PARK_AFTER_MS from now, unless something wakes it first. */
  private arm(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.idle(), PARK_AFTER_MS);
  }

  private idle(): void {
    this.timer = undefined;
    const insert = getCM(this.view)?.state.vim?.insertMode === true;
    if (!this.view.hasFocus || insert || this.view.state.field(parked)) return;
    this.view.dispatch({ effects: setParked.of(true) });
  }

  destroy(): void {
    clearTimeout(this.timer);
    for (const type of WAKE) this.view.dom.removeEventListener(type, this.wake, true);
  }
}

/** The lecture buffer's native-caret parking. Goes with `caretBlink` (caret.ts). */
export const nativeCaret: Extension = [
  parked,
  ViewPlugin.fromClass(NativeCaret),
  // Focusable while not editable, so parking keeps the focus and Tab still reaches the editor.
  EditorView.contentAttributes.of({ tabindex: "0" }),
  // A parked editor looks the same: the text cursor over it, and no blink in Chromium at all.
  EditorView.theme({ ".cm-content": { cursor: "text", caretAnimation: "manual" } }),
];
