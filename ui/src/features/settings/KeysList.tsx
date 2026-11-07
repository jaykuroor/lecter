// Settings → Keys (10-keymap.md: every binding is rebindable in keymaps.jsonc): every command with
// the keys that run it now, keymaps.jsonc included, as the command palette lists them. Each row is
// a stop for j/k; the first is a Tab stop.
import { For, type JSX } from "solid-js";
import type { Binding } from "../../keys/keymap";
import { commandEntries } from "../palette/entries";

export function KeysList(props: { bindings: readonly Binding[]; mac: boolean }): JSX.Element {
  const entries = () => commandEntries(props.bindings, props.mac);
  return (
    <>
      <p class="settings-intro">
        Change these in <code>keymaps.jsonc</code> in Lecter's settings folder; Lecter reads it when it starts.
      </p>
      <ul class="settings-keys" aria-label="Keys">
        <For each={entries()}>
          {(entry, i) => (
            <li class="settings-row settings-keys-row" tabindex={i() === 0 ? 0 : -1}>
              <span class="settings-label">{entry.title}</span>
              <span class="settings-keys-where">{entry.where}</span>
              <span class="settings-keys-caps">
                <For each={entry.keys}>{(k) => <kbd class="sidebar-key">{k}</kbd>}</For>
              </span>
            </li>
          )}
        </For>
      </ul>
    </>
  );
}
