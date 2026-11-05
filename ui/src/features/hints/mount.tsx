// The hint bar at work in the page: a chunk of its own, loaded with the key engine after the first
// paint (D-202), so the shell paints without it. It follows where the focus and the cursor are:
// after every key, click and focus change it looks again, once per frame, and the bar changes only
// when the element or the mode did (09-ui.md: it changes with the cursor's element and the mode).
import { createMemo, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { registerCommand, runCommand } from "../../keys/commands";
import type { Element, KeyEngine } from "../../keys/engine";
import type { Mode } from "../../keys/keymap";
import { locate } from "../../keys/locate";
import { DEFAULT_HINT_DETAIL, type HintDetail, nextDetail } from "./detail";
import { HintBar } from "./HintBar";
import { type Hint, hintsFor } from "./hints";

export interface HintBarHandle {
  /** Reads the engine's keymap again (keymaps.jsonc was laid over the defaults). */
  refresh: () => void;
  stop: () => void;
}

/** What moves the cursor or the focus, or changes Vim's mode: the bar looks again after each. */
const EVENTS = ["keydown", "pointerdown", "pointerup", "focusin", "focusout"] as const;

/**
 * Shows the hint bar in `host` for `engine`'s keymap, at `ui.hintBar`'s `detail` until ␣uh
 * changes it.
 */
export function startHintBar(opts: { engine: KeyEngine; host: HTMLElement; detail?: HintDetail }): HintBarHandle {
  const at = () => {
    const w = locate(document.activeElement);
    return { el: w.el, mode: w.mode };
  };
  const [where, setWhere] = createSignal<{ el: Element; mode: Mode }>(at());
  const [detail, setDetail] = createSignal<HintDetail>(opts.detail ?? DEFAULT_HINT_DETAIL);
  // Pinged when the engine's keymap was replaced; it carries nothing, so every ping counts.
  const [keymap, keymapChanged] = createSignal(undefined, { equals: false });

  let frame = 0;
  /** Where the focus is now; the signal changes only when the element or the mode did. */
  const look = () => {
    frame = 0;
    const w = at();
    const now = where();
    if (w.el !== now.el || w.mode !== now.mode) setWhere(w);
  };
  /** Looks once, in the next frame: after the key or click is done with, before it shows. */
  const schedule = () => {
    if (frame === 0) frame = window.requestAnimationFrame(look);
  };

  const pick = (hint: Hint) => {
    if (hint.binding) {
      opts.engine.reset();
      runCommand({ binding: hint.binding, count: 1, explicit: false });
    } else opts.engine.setPrefix(hint.prefix);
    schedule();
  };

  const dispose = render(() => {
    const hints = createMemo(() => {
      keymap();
      const w = where();
      return hintsFor(opts.engine.map, w.el, w.mode);
    });
    return <HintBar hints={hints()} detail={detail()} onPick={pick} />;
  }, opts.host);
  for (const type of EVENTS) window.addEventListener(type, schedule, { capture: true });
  const dropDetail = registerCommand("ui.hintDetail", () => {
    setDetail(nextDetail(detail()));
  });

  return {
    refresh: () => keymapChanged(),
    stop: () => {
      for (const type of EVENTS) window.removeEventListener(type, schedule, { capture: true });
      // Cancelling 0 (nothing waiting) does nothing.
      window.cancelAnimationFrame(frame);
      dropDetail();
      dispose();
    },
  };
}
