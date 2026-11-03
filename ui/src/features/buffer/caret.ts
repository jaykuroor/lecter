// The caret blinks for 10 s after the last key or click, then stays solid until the next one, so an
// idle window draws nothing (09-ui.md#editing, 14-quality.md#performance-budgets; GTK's
// behaviour, D-146). CodeMirror's own blink is a CSS animation that never ends (`cm-blink ...
// infinite` on each focused cursor layer), which kept the webview compositing forever. Here it is
// switched off, and each cursor layer gets one Web Animation with a finite number of cycles
// instead, restarted by a key, a click, a cursor move or focus. When it ends, nothing is left
// running: no timer, no frame, no DOM change. Under reduced motion the caret never blinks.
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/** The caret blinks for this long after the last key or click (GTK's blink timeout). */
export const BLINK_FOR_MS = 10_000;

/** One blink cycle, as long as CodeMirror's (`cursorBlinkRate`, 1.2 s). */
const CYCLE_MS = 1_200;

/** One cycle as CodeMirror's `cm-blink`: shown for the first half, hidden for the second. */
const BLINK: Keyframe[] = [{ opacity: 1, easing: "step-end" }, { opacity: 0, offset: 0.5 }, { opacity: 0 }];

/** CodeMirror's caret layers (its own, and Vim's block cursor), direct children of the scroller. */
const LAYERS = ":scope > .cm-cursorLayer";

class CaretBlink {
  /** One animation per caret layer, made at the first blink and replayed after that. */
  private readonly blinks = new Map<HTMLElement, Animation>();
  private readonly reduceMotion: MediaQueryList | null;

  constructor(private readonly view: EditorView) {
    this.reduceMotion = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    // Focused already (another lecture opened into the same editor): no focus change will come.
    this.input();
  }

  update(update: ViewUpdate): void {
    if (update.focusChanged || update.selectionSet) this.input();
  }

  /** A key, click, cursor move or focus change: blink for the next 10 s if the editor has focus. */
  input(): void {
    if (!this.view.hasFocus || this.reduceMotion?.matches) {
      this.stop();
      return;
    }
    for (const layer of this.view.scrollDOM.querySelectorAll<HTMLElement>(LAYERS)) {
      const blink = this.blinks.get(layer);
      if (blink) {
        blink.currentTime = 0;
        blink.play();
      } else if (typeof layer.animate === "function") {
        this.blinks.set(layer, layer.animate(BLINK, { duration: CYCLE_MS, iterations: BLINK_FOR_MS / CYCLE_MS }));
      }
    }
  }

  stop(): void {
    for (const blink of this.blinks.values()) blink.cancel();
  }

  destroy(): void {
    this.stop();
  }
}

const caretPlugin = ViewPlugin.fromClass(CaretBlink, {
  // Observers, not handlers: they see every key and click and never stop another handler.
  // A click that moves nothing (on the caret's place, or the context-menu button) dispatches no
  // selection, so it needs its own restart.
  eventObservers: {
    keydown() {
      this.input();
    },
    mousedown() {
      this.input();
    },
  },
});

/**
 * The lecture buffer's caret blink. Goes after `drawSelection()` and `vim()`, whose cursor layers
 * it animates.
 */
export const caretBlink: Extension = [
  caretPlugin,
  // `!important` beats the animation name CodeMirror sets inline on each layer to restart its blink.
  EditorView.theme({ "& > .cm-scroller > .cm-cursorLayer": { animation: "none !important" } }),
];
