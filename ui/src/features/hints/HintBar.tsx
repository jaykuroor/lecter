// The hint bar (09-ui.md#hint-bar-and-keystroke-overlay, docs/design/components.md#hint-bar-and-which-key):
// one line above the status line with the keys that work now, as keycaps and words. The element's
// own keys come first and are cut where the line ends; the global keys and ␣ More stay at the
// end. A hint that a click can run is a button, the mouse way to its key; the rest are text.
import { For, type JSX, Show } from "solid-js";
import type { HintDetail } from "./detail";
import type { Hint, Hints } from "./hints";
import { mouseAction } from "./mouse";
import "./HintBar.css";

interface ItemProps {
  hint: Hint;
  detail: HintDetail;
  canPick: (hint: Hint) => boolean;
  onPick: (hint: Hint) => void;
}

/** A hint's keycaps, words and, in full, its mouse action. */
function Face(props: { hint: Hint; detail: HintDetail }): JSX.Element {
  return (
    <>
      <For each={props.hint.keys}>{(key) => <kbd class="hint-key">{key}</kbd>}</For>
      <span class="hint-desc">{props.hint.desc}</span>
      <Show when={props.detail === "full"}>
        <span class="hint-mouse">{mouseAction(props.hint)}</span>
      </Show>
    </>
  );
}

function Item(props: ItemProps): JSX.Element {
  return (
    <li>
      <Show
        when={props.canPick(props.hint)}
        fallback={
          <span class="hint">
            <Face hint={props.hint} detail={props.detail} />
          </span>
        }
      >
        <button
          type="button"
          class="hint"
          tabIndex={-1}
          // Keeps the focus where it was (the buffer), so the cursor and the next key stay there.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => props.onPick(props.hint)}
        >
          <Face hint={props.hint} detail={props.detail} />
        </button>
      </Show>
    </li>
  );
}

/**
 * The bar for `hints` at `detail` (`off`: nothing at all); a click on a hint `canPick` allows
 * goes to `onPick`.
 */
export function HintBar(props: {
  hints: Hints;
  detail: HintDetail;
  canPick: (hint: Hint) => boolean;
  onPick: (hint: Hint) => void;
}): JSX.Element {
  return (
    <Show when={props.detail !== "off"}>
      <section class="hint-bar" aria-label="Keys that work now" data-detail={props.detail}>
        <ul class="hint-list hint-main">
          <For each={props.hints.main}>
            {(h) => <Item hint={h} detail={props.detail} canPick={props.canPick} onPick={props.onPick} />}
          </For>
        </ul>
        <ul class="hint-list hint-tail">
          <For each={props.hints.tail}>
            {(h) => <Item hint={h} detail={props.detail} canPick={props.canPick} onPick={props.onPick} />}
          </For>
        </ul>
      </section>
    </Show>
  );
}
