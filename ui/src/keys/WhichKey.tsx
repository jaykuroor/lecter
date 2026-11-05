// Which-key (09-ui.md#hint-bar-and-keystroke-overlay, docs/design/components.md#hint-bar-and-which-key):
// 300 ms after the leader, a popover over the document lists what can follow, all groups first
// time. Picking a group (by key or by click) lists that group's keys; a key or a click runs one.
import { createSignal, For, type JSX, Show } from "solid-js";
import { render } from "solid-js/web";
import { type Choice, choices, type KeyEngine } from "./engine";
import type { Binding } from "./keymap";
import type { Where } from "./locate";
import { keyLabel } from "./notation";
import "./WhichKey.css";

/** How long the leader waits before which-key shows (09-ui.md: 300 ms). */
const WHICH_KEY_DELAY_MS = 300;

const LEADER = "<Space>";

interface Shown {
  prefix: string[];
  choices: Choice[];
}

export interface WhichKey {
  /** Whether `target` is inside the popover. */
  contains: (target: EventTarget | null) => boolean;
  dispose: () => void;
}

/** The popover's face: the keys typed so far, then each choice as a keycap and what it does. */
function Popover(props: { shown: Shown; mac: boolean; onPick: (choice: Choice) => void }): JSX.Element {
  const label = (keys: readonly string[]) => keys.map((k) => keyLabel(k, props.mac)).join("");
  return (
    <div class="which-key" role="dialog" aria-label="Keys that can follow">
      <div class="which-key-title">
        <span class="which-key-prefix">{label(props.shown.prefix)}</span>
        <span class="which-key-hint">Esc to close</span>
      </div>
      <ul class="which-key-list">
        <For each={props.shown.choices}>
          {(c) => (
            <li>
              <button
                type="button"
                class={c.group ? "which-key-item which-key-group" : "which-key-item"}
                tabIndex={-1}
                // Keeps the focus where it was (the buffer), so the next key still goes there.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => props.onPick(c)}
              >
                <kbd class="which-key-key">{keyLabel(c.key, props.mac)}</kbd>
                <span class="which-key-desc">{c.group ? `+${c.binding.desc}` : c.binding.desc}</span>
              </button>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}

/**
 * Follows `engine`: once a sequence that starts with the leader has waited 300 ms, shows what can
 * follow it where the focus is (`where`), in `host`. While it shows, the next group shows at once.
 */
export function createWhichKey(opts: {
  engine: KeyEngine;
  host: HTMLElement;
  mac: boolean;
  where: () => Where;
  run: (binding: Binding, count: number, explicit: boolean) => boolean;
}): WhichKey {
  const [shown, setShown] = createSignal<Shown | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unmount: (() => void) | undefined;
  let mount: HTMLDivElement | undefined;

  const show = () => {
    timer = undefined;
    const prefix = opts.engine.sequence();
    const w = opts.where();
    if (!mount) {
      mount = document.createElement("div");
      opts.host.append(mount);
      unmount = render(
        () => <Show when={shown()}>{(s) => <Popover shown={s()} mac={opts.mac} onPick={pick} />}</Show>,
        mount,
      );
    }
    setShown({ prefix, choices: choices(opts.engine.map, w.el, w.mode, prefix) });
  };

  const pick = (c: Choice) => {
    const prefix = opts.engine.sequence();
    if (c.group) {
      opts.engine.setPrefix([...prefix, c.key]);
      return;
    }
    opts.engine.reset();
    opts.run(c.binding, 1, false);
  };

  opts.engine.onChange = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (opts.engine.sequence()[0] !== LEADER) {
      setShown(null);
      return;
    }
    if (shown()) show();
    else timer = setTimeout(show, WHICH_KEY_DELAY_MS);
  };

  return {
    // The popover is all there is in `mount`.
    contains: (target) => target instanceof Node && mount?.contains(target) === true,
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
      unmount?.();
      mount?.remove();
    },
  };
}
