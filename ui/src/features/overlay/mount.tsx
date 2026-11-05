// The keystroke overlay (09-ui.md#hint-bar-and-keystroke-overlay): bottom right of the buffer, the
// keys typed, including pending sequences, fading 1.5 s after the last one. A chunk of its own,
// loaded with the key engine after the first paint (D-202). The keydown only queues the event:
// the keys are read, and the overlay drawn, once in the next frame (keystroke_p99_ms).
import { batch, createSignal, Index, Show } from "solid-js";
import { render } from "solid-js/web";
import { registerCommand } from "../../keys/commands";
import type { KeyEngine } from "../../keys/engine";
import { eventToken, keyLabel } from "../../keys/notation";
import { addKeys, EMPTY_STRIP, isPending, type Strip } from "./strip";
import "./KeystrokeOverlay.css";

/** How long the overlay stays after the last key before it fades (09-ui.md: 1.5 s). */
export const FADE_AFTER_MS = 1500;
/** How long the fade takes; then the overlay is gone. */
export const FADE_MS = 200;
/** `ui.keystrokes` before anything sets it: on (09-ui.md: on by default for new users). */
const DEFAULT_KEYSTROKES = true;

export interface OverlayHandle {
  /** Hands over a keydown the engine has seen (App calls it after the engine, for every key). */
  typed: (e: KeyboardEvent) => void;
  stop: () => void;
}

/** Whether a keydown should never show: an input method's, or one typed into a password. */
const unshown = (e: KeyboardEvent): boolean =>
  e.isComposing || (e.target instanceof HTMLInputElement && e.target.type === "password");

/**
 * Shows the overlay in `host` for `engine`. It starts at `on`, the value of `ui.keystrokes` (on
 * when there is none), and ␣uk turns it off and on; while `hidden` (read mode) it shows nothing.
 */
export function startOverlay(opts: {
  engine: KeyEngine;
  host: HTMLElement;
  mac: boolean;
  hidden: () => boolean;
  on?: boolean;
}): OverlayHandle {
  const [on, setOn] = createSignal(opts.on ?? DEFAULT_KEYSTROKES);
  const [strip, setStrip] = createSignal<Strip>(EMPTY_STRIP);
  const [fading, setFading] = createSignal(false);
  const queue: KeyboardEvent[] = [];
  /**
   * While off or hidden, the shown keys the engine still holds: the `␣u` of the `␣uk` that turns
   * it on, which came in frames of their own before the `k` (WebKit draws between keys).
   */
  let held: string[] = [];
  let frame = 0;
  let stopped = false;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  let goneTimer: ReturnType<typeof setTimeout> | undefined;

  const clearTimers = () => {
    clearTimeout(fadeTimer);
    clearTimeout(goneTimer);
  };
  // Gone: the next key starts a new strip (and sets `fading` back).
  const clear = () => setStrip(EMPTY_STRIP);

  /** The frame's work: the keys queued since the last frame, and what the engine holds now. */
  const flush = () => {
    frame = 0;
    const events = queue.splice(0);
    const typed: string[] = [];
    for (const e of events) {
      const token = unshown(e) ? null : eventToken(e);
      if (token !== null) typed.push(token);
    }
    const pending = opts.engine.pending().length;
    if (!on() || opts.hidden()) {
      const kept = held.concat(typed);
      held = pending === 0 ? [] : kept.slice(-pending);
      clear();
      return;
    }
    // The held keys go in front of the key that ended their sequence, or show while the engine
    // still holds them; once a click ended it (nothing typed, nothing pending) they go.
    const tokens = typed.length > 0 || pending > 0 ? held.concat(typed) : typed;
    held = [];
    if (tokens.length === 0) {
      // Only the engine changed (a click ended a sequence): the marks follow, the timers stay.
      setStrip(addKeys(strip(), [], pending));
      return;
    }
    batch(() => {
      // Keys after the fade began start a new strip.
      setStrip(addKeys(fading() ? EMPTY_STRIP : strip(), tokens, pending));
      setFading(false);
    });
    clearTimers();
    fadeTimer = setTimeout(() => {
      setFading(true);
      goneTimer = setTimeout(clear, FADE_MS);
    }, FADE_AFTER_MS);
  };
  const schedule = () => {
    if (frame === 0 && !stopped) frame = window.requestAnimationFrame(flush);
  };

  // The engine says when its pending keys change, which-key first; a click can end a sequence.
  const before = opts.engine.onChange;
  const follow = (pending: readonly string[]) => {
    before(pending);
    schedule();
  };
  opts.engine.onChange = follow;

  const dispose = render(
    () => (
      <Show when={strip().keys.length > 0}>
        <div class={fading() ? "keystroke-overlay keystroke-overlay-fading" : "keystroke-overlay"} aria-hidden="true">
          <Index each={strip().keys}>
            {(key, i) => (
              <kbd class={isPending(strip(), i) ? "keystroke-key keystroke-pending" : "keystroke-key"}>
                {keyLabel(key(), opts.mac)}
              </kbd>
            )}
          </Index>
        </div>
      </Show>
    ),
    opts.host,
  );
  const dropCommand = registerCommand("ui.keystrokes", () => {
    setOn(!on());
    schedule();
  });

  return {
    typed: (e) => {
      queue.push(e);
      schedule();
    },
    stop: () => {
      stopped = true;
      // Cancelling 0 (nothing waiting) does nothing.
      window.cancelAnimationFrame(frame);
      frame = 0;
      queue.length = 0;
      clearTimers();
      if (opts.engine.onChange === follow) opts.engine.onChange = before;
      dropCommand();
      dispose();
    },
  };
}
