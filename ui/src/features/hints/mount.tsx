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
  const [where, setWhere] = createSignal<{ el: Element; mode: Mode }>({ el: "page", mode: "normal" });
  const [detail, setDetail] = createSignal<HintDetail>(opts.detail ?? DEFAULT_HINT_DETAIL);
  const [version, setVersion] = createSignal(0);

  let frame = 0;
  /** Where the focus is now; the signal changes only when the element or the mode did. */
  const look = () => {
    frame = 0;
    const w = locate(document.activeElement);
    const now = where();
    if (w.el !== now.el || w.mode !== now.mode) setWhere({ el: w.el, mode: w.mode });
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
      version();
      const w = where();
      return hintsFor(opts.engine.map, w.el, w.mode);
    });
    return <HintBar hints={hints()} detail={detail()} onPick={pick} />;
  }, opts.host);
  for (const type of EVENTS) window.addEventListener(type, schedule, { capture: true });
  const dropDetail = registerCommand("ui.hintDetail", () => {
    setDetail(nextDetail(detail()));
  });
  look();

  return {
    refresh: () => setVersion(version() + 1),
    stop: () => {
      for (const type of EVENTS) window.removeEventListener(type, schedule, { capture: true });
      if (frame !== 0) window.cancelAnimationFrame(frame);
      dropDetail();
      dispose();
    },
  };
}
