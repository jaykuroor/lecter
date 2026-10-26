import { For, type JSX, Show } from "solid-js";
import type { FindState } from "../../state/find";
import "./FindPanel.css";

/**
 * `:find` results in the side panel (10-keymap.md#commands, 05-retrieval.md#search): a search
 * field with its Find button (the mouse path; `:find words` in the buffer is the key path, shown
 * as a keycap), a status line, and the hits, best first, each with its lecture, block id,
 * breadcrumb and text. Citations and `gd` to a hit arrive with F-132.
 */
export function FindPanel(props: {
  state: FindState;
  /** Runs a search for the words typed in the field. */
  onFind: (words: string) => void;
}): JSX.Element {
  let input!: HTMLInputElement;
  const submit = () => props.onFind(input.value);
  // Enter is handled here, not left to the form's implicit submission: that runs only for trusted
  // key events, so a synthetic key (the embedded WebDriver, assistive tools) would never search.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    submit();
  };
  return (
    <section class="find-panel" aria-label="Find">
      <h2 class="find-title">
        Find <kbd class="find-key">:find</kbd>
      </h2>
      <form
        class="find-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          ref={input}
          class="find-input"
          type="search"
          aria-label="Find in lectures"
          placeholder="Words in the opened lectures"
          maxLength={1024}
          value={props.state.query()}
          onKeyDown={onKeyDown}
        />
        <button type="submit" class="find-submit" disabled={props.state.busy()}>
          Find
        </button>
      </form>
      <Show when={props.state.error()}>
        {(message) => (
          <p class="find-error" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <p class="find-status" role="status" aria-live="polite">
        {status(props.state)}
      </p>
      <Show when={props.state.hits().length > 0}>
        <ol class="find-hits" aria-label="Find results">
          <For each={props.state.hits()}>
            {(hit) => (
              <li class="find-hit" data-lecture={hit.lecture} data-block={hit.block}>
                <span class="find-hit-where">
                  {fileName(hit.lecture)} · {hit.block}
                </span>
                <span class="find-hit-crumb">{hit.breadcrumb}</span>
                <span class="find-hit-text">{hit.text}</span>
              </li>
            )}
          </For>
        </ol>
      </Show>
    </section>
  );
}

/** The status line under the field: searching, the hit count, or nothing before a search. */
export function status(state: Pick<FindState, "query" | "hits" | "error" | "busy">): string {
  const q = state.query();
  if (state.busy()) return `Searching for “${q}”…`;
  if (!q || state.error()) return "";
  const n = state.hits().length;
  if (n === 0) return `No hits for “${q}”`;
  return `${n} ${n === 1 ? "hit" : "hits"} for “${q}”`;
}

/** `lectures/l07.md` → `l07.md`. */
function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
