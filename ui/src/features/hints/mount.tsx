// The hint bar at work in the page: a chunk of its own, loaded with the key engine after the first
// paint (D-202), so the shell paints without it. It follows where the focus and the cursor are:
// after every key, click and focus change it looks again, once per frame, and the bar changes only
// when the keys that apply did (09-ui.md: it changes with the cursor's element and the mode).
import { createMemo, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { hasCommand, registerCommand, watchCommands } from "../../keys/commands";
import { runWithoutKey, vimTakes } from "../../keys/dispatch";
import { type Element, inBuffer, type KeyEngine, scopesFor } from "../../keys/engine";
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

/** Where the keys are, as far as the bar goes: two places with the same `key` show the same hints. */
interface Place {
  el: Element;
  mode: Mode;
  key: string;
}

/**
 * Where the focus is now, or `null` while Vim waits for the rest of a command (`d`, `y`, `f`): the
 * key engine then counts the buffer as typing, but Vim's mode (`data-vim-mode`) is still normal, and
 * the bar keeps what it showed.
 */
function place(): Place | null {
  const w = locate(document.activeElement);
  const vim = w.buffer?.root.getAttribute("data-vim-mode");
  if (w.mode === "insert" && (vim === "normal" || vim === "visual")) return null;
  return { el: w.el, mode: w.mode, key: `${scopesFor(w.el, w.mode).join()} ${w.mode} ${inBuffer(w.el)}` };
}

/**
 * Shows the hint bar in `host` for `engine`'s keymap. It starts at `detail`, the value of
 * `ui.hintBar` (full when there is none, D-206), and ␣uh steps it on.
 */
export function startHintBar(opts: { engine: KeyEngine; host: HTMLElement; detail?: HintDetail }): HintBarHandle {
  const [where, setWhere] = createSignal<Place>(place() ?? { el: "page", mode: "normal", key: "" }, {
    equals: (a, b) => a.key === b.key,
  });
  const [detail, setDetail] = createSignal<HintDetail>(opts.detail ?? DEFAULT_HINT_DETAIL);
  // Pinged when the engine's keymap was replaced, or a command's handler came or went; they carry
  // nothing, so every ping counts.
  const [keymap, keymapChanged] = createSignal(undefined, { equals: false });
  const [commands, commandsChanged] = createSignal(undefined, { equals: false });

  let frame = 0;
  const look = () => {
    frame = 0;
    const now = place();
    if (now) setWhere(now);
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
    if (!hint.binding) return true;
    if (hint.family) return false;
    return hasCommand(hint.binding.command) || (inBuffer(where().el) && vimTakes(hint.tokens));
  };
  const pick = (hint: Hint) => {
    if (hint.binding) {
      opts.engine.reset();
      runWithoutKey(hint.binding, hint.tokens, locate(document.activeElement).buffer);
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
