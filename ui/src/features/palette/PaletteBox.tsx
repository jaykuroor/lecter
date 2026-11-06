// The command palette and quick switcher box (09-ui.md#slack-and-discord-behaviours), styled as
// the command line's (docs/design/components.md#cmdline): a field, then the rows that match, each
// with its keycaps (a command) or its kind and place (a course, lecture, list or source). ↓/↑,
// Tab/Shift-Tab and Ctrl-j/Ctrl-k move the pick, Enter or a click takes it, Esc closes; the field
// keeps every other key, so typing filters.
import { createEffect, For, type JSX, Show } from "solid-js";
import type { Palette, Row } from "./state";
import "./Palette.css";

const LIST_ID = "palette-options";
const optionId = (i: number) => `palette-option-${i}`;

/** The pick's move for a key in the field, or `null` when the field keeps the key. */
function moveFor(e: KeyboardEvent): number | null {
  if (e.altKey || e.metaKey) return null;
  if (e.ctrlKey) return e.key === "j" ? 1 : e.key === "k" ? -1 : null;
  if (e.key === "ArrowDown") return 1;
  if (e.key === "ArrowUp") return -1;
  if (e.key === "Tab") return e.shiftKey ? -1 : 1;
  return null;
}

/** The label with the matched letters marked. */
function Marked(props: { row: Row }): JSX.Element {
  const parts = () => {
    const hits = new Set(props.row.hits);
    const out: { text: string; hit: boolean }[] = [];
    // Hits index UTF-16 units, as the match does; a pair's halves are never split (a query letter
    // outside the BMP never matches), so they always land in the same part.
    props.row.label.split("").forEach((ch, i) => {
      const hit = hits.has(i);
      const last = out[out.length - 1];
      if (last && last.hit === hit) last.text += ch;
      else out.push({ text: ch, hit });
    });
    return out;
  };
  return (
    <span class="palette-label">
      <For each={parts()}>{(p) => (p.hit ? <mark class="palette-hit">{p.text}</mark> : p.text)}</For>
    </span>
  );
}

export function PaletteBox(props: { palette: Palette }): JSX.Element {
  const p = props.palette;
  let list: HTMLDivElement | undefined;

  // The picked row stays in view as it moves.
  createEffect(() => {
    const i = p.picked();
    if (p.mode() === null) return;
    list?.querySelector(`#${optionId(i)}`)?.scrollIntoView?.({ block: "nearest" });
  });

  const onKeyDown = (e: KeyboardEvent) => {
    const delta = moveFor(e);
    if (delta !== null) p.move(delta);
    else if (e.key === "Enter") p.pick();
    else if (e.key === "Escape") p.close();
    else return;
    e.preventDefault();
  };

  // The focus left the box (a click elsewhere, another window): close, leaving the focus there.
  const onFocusOut = (e: FocusEvent & { currentTarget: HTMLElement }) => {
    const to = e.relatedTarget;
    if (to instanceof Node && e.currentTarget.contains(to)) return;
    p.close(false);
  };

  return (
    <Show when={p.mode()}>
      {(mode) => (
        <div
          class="palette"
          role="dialog"
          aria-label={mode() === "commands" ? "Command palette" : "Quick switcher"}
          onFocusOut={onFocusOut}
        >
          <span class="palette-notch" aria-hidden="true">
            {mode() === "commands" ? "Commands" : "Go to"}
          </span>
          <input
            ref={(el) => {
              // Focus once it is in the page, before the next key: what is typed next filters.
              queueMicrotask(() => el.focus());
            }}
            class="palette-input"
            type="text"
            role="combobox"
            aria-label={mode() === "commands" ? "Command" : "Go to"}
            placeholder={mode() === "commands" ? "Run a command" : "Go to a course, lecture, list or source"}
            aria-autocomplete="list"
            aria-controls={LIST_ID}
            aria-expanded={p.rows().length > 0}
            aria-activedescendant={p.rows().length > 0 ? optionId(p.picked()) : undefined}
            autocomplete="off"
            spellcheck={false}
            value={p.query()}
            onInput={(e) => p.setQuery(e.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
          <div
            id={LIST_ID}
            class="palette-list"
            role="listbox"
            aria-label={mode() === "commands" ? "Commands" : "Places"}
            ref={list}
          >
            <For each={p.rows()}>
              {(row, i) => (
                <div
                  id={optionId(i())}
                  class="palette-row"
                  role="option"
                  tabIndex={-1}
                  aria-selected={p.picked() === i()}
                  aria-disabled={row.disabled ? "true" : undefined}
                  aria-keyshortcuts={row.keys.length > 0 ? row.keys.join(" ") : undefined}
                  onMouseDown={(e) => {
                    // Keep the focus in the field: it goes back where it was once the row runs.
                    e.preventDefault();
                    p.pick(i());
                  }}
                >
                  <Marked row={row} />
                  <Show when={row.kind}>
                    <span class="palette-kind">{row.kind}</span>
                  </Show>
                  <span class="palette-detail">{row.detail}</span>
                  <span class="palette-keys">
                    <For each={row.keys}>{(k) => <kbd class="palette-key">{k}</kbd>}</For>
                  </span>
                </div>
              )}
            </For>
          </div>
          <Show when={p.rows().length === 0}>
            <p class="palette-note">No matches</p>
          </Show>
          <Show when={p.more() > 0}>
            <p class="palette-note">{p.more()} more: type to narrow</p>
          </Show>
        </div>
      )}
    </Show>
  );
}
