// The hint bar (09-ui.md#hint-bar-and-keystroke-overlay, docs/design/components.md#hint-bar-and-which-key):
// one line above the status line with the keys that work now, as keycaps and words. The element's
// own keys come first and are cut where the line ends; the global keys and ␣ More stay at the
// end. Every hint is also a button, the mouse way to its key.
import { For, type JSX, Show } from "solid-js";
import type { HintDetail } from "./detail";
import type { Hint, Hints } from "./hints";
import { mouseAction } from "./mouse";
import "./HintBar.css";

function Item(props: { hint: Hint; detail: HintDetail; onPick: (hint: Hint) => void }): JSX.Element {
  return (
    <li>
      <button
        type="button"
        class="hint"
        tabIndex={-1}
        // Keeps the focus where it was (the buffer), so the cursor and the next key stay there.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => props.onPick(props.hint)}
      >
        <For each={props.hint.keys}>{(key) => <kbd class="hint-key">{key}</kbd>}</For>
        <span class="hint-desc">{props.hint.desc}</span>
        <Show when={props.detail === "full"}>
          <span class="hint-mouse">{mouseAction(props.hint)}</span>
        </Show>
      </button>
    </li>
  );
}

/** The bar for `hints` at `detail` (`off`: nothing at all); a click on a hint goes to `onPick`. */
export function HintBar(props: { hints: Hints; detail: HintDetail; onPick: (hint: Hint) => void }): JSX.Element {
  return (
    <Show when={props.detail !== "off"}>
      <section class="hint-bar" aria-label="Keys that work now" data-detail={props.detail}>
        <ul class="hint-list hint-main">
          <For each={props.hints.main}>{(h) => <Item hint={h} detail={props.detail} onPick={props.onPick} />}</For>
        </ul>
        <ul class="hint-list hint-tail">
          <For each={props.hints.tail}>{(h) => <Item hint={h} detail={props.detail} onPick={props.onPick} />}</For>
        </ul>
      </section>
    </Show>
  );
}
