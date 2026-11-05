// The hint bar at work in the page: a chunk of its own, loaded with the key engine after the first
// paint (D-202), so the shell paints without it. It follows where the focus and the cursor are:
// after every key, click and focus change it looks again, once per frame, and the bar changes only
// when the keys that apply did (09-ui.md: it changes with the cursor's element and the mode).
import { createMemo, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { hasCommand, registerCommand, watchCommands } from "../../keys/commands";
import { runWithoutKey, vimTakes } from "../../keys/dispatch";
import { type Element, inBuffer, type KeyEngine, scopesFor } from "../../keys/engine";
import type { Binding, Mode } from "../../keys/keymap";
import { type BufferTarget, locate } from "../../keys/locate";
import { parseKeys } from "../../keys/notation";
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

/** Where the keys are, as far as the bar goes: two places with the same `key` show the same hints. */
interface Place {
  el: Element;
  mode: Mode;
  key: string;
}

const at = (el: Element, mode: Mode): Place => ({
  el,
  mode,
  key: `${scopesFor(el, mode).join()} ${mode} ${inBuffer(el)}`,
});

/**
 * Where the focus is now. While Vim waits for the rest of a command (`d`, `y`, `f`) the key engine
 * counts the buffer as typing, but Vim's own mode (`data-vim-mode`) is still normal or visual: the
 * bar goes by that, so it keeps what it showed.
 */
function place(): Place {
  const w = locate(document.activeElement);
  const buffer = w.buffer;
  const vim = buffer?.root.getAttribute("data-vim-mode");
  if (vim === "normal" || vim === "visual") return at((buffer as BufferTarget).element(), vim);
  return at(w.el, w.mode);
}

/**
 * Shows the hint bar in `host` for `engine`'s keymap. It starts at `detail`, the value of
 * `ui.hintBar` (full when there is none, D-206), and ␣uh steps it on.
 */
export function startHintBar(opts: { engine: KeyEngine; host: HTMLElement; detail?: HintDetail }): HintBarHandle {
  const [where, setWhere] = createSignal<Place>(place(), {
    equals: (a, b) => a.key === b.key,
  });
  const [detail, setDetail] = createSignal<HintDetail>(opts.detail ?? DEFAULT_HINT_DETAIL);
  // Pinged when the engine's keymap was replaced, or a command's handler came or went; they carry
  // nothing, so every ping counts.
  const [keymap, keymapChanged] = createSignal(undefined, { equals: false });
  const [commands, commandsChanged] = createSignal(undefined, { equals: false });

  /** A binding's keys as tokens (the hint bar shows only bindings whose keys parse). */
  const tokens = (b: Binding) => parseKeys(b.keys, opts.engine.map.mac);

  let frame = 0;
  const look = () => {
    frame = 0;
    setWhere(place());
  };
  /** Looks once, in the next frame: after the key or click is done with, before it shows. */
  const schedule = () => {
    if (frame === 0) frame = window.requestAnimationFrame(look);
  };

  /**
   * Whether a click can do what the hint's key does: ␣ More always; a numbered family never; a
   * binding when its command has a handler, or when in the buffer its keys go on to Vim.
   */
  const canPick = (hint: Hint): boolean => {
    commands();
    if (hint.family) return false;
    if (!hint.binding) return true;
    return hasCommand(hint.binding.command) || (inBuffer(where().el) && vimTakes(tokens(hint.binding)));
  };
  const pick = (hint: Hint) => {
    if (hint.binding) {
      opts.engine.reset();
      runWithoutKey(hint.binding, tokens(hint.binding), locate(document.activeElement).buffer);
    } else opts.engine.setPrefix(hint.prefix);
    schedule();
  };

  const dispose = render(() => {
    const hints = createMemo(() => {
      keymap();
      const w = where();
      return hintsFor(opts.engine.map, w.el, w.mode);
    });
    return <HintBar hints={hints()} detail={detail()} canPick={canPick} onPick={pick} />;
  }, opts.host);
  for (const type of EVENTS) window.addEventListener(type, schedule, { capture: true });
  const dropDetail = registerCommand("ui.hintDetail", () => {
    setDetail(nextDetail(detail()));
  });
  const unwatch = watchCommands(() => commandsChanged());

  return {
    refresh: () => keymapChanged(),
    stop: () => {
      for (const type of EVENTS) window.removeEventListener(type, schedule, { capture: true });
      // Cancelling 0 (nothing waiting) does nothing.
      window.cancelAnimationFrame(frame);
      unwatch();
      dropDetail();
      dispose();
    },
  };
}
