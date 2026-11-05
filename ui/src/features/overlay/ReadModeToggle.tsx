import type { JSX } from "solid-js";

/**
 * The headerbar's Read mode button (docs/design/components.md#headerbar, right controls), the
 * mouse way in and out of read mode, with its key as a keycap. `␣ur` and `:read` do the same
 * (App.tsx). It stays in read mode: the headerbar does.
 */
export function ReadModeToggle(props: { on: boolean; onToggle: () => void }): JSX.Element {
  return (
    <button
      type="button"
      class="read-toggle"
      aria-label="Read mode"
      aria-pressed={props.on ? "true" : "false"}
      aria-keyshortcuts="Space u r"
      title={props.on ? "Leave read mode (␣ur)" : "Read mode: hide the rail, sidebar and hints (␣ur)"}
      onClick={() => props.onToggle()}
    >
      <svg class="read-toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M8 4c-1.6-1.1-3.6-1.5-6-1.5v10c2.4 0 4.4.4 6 1.5 1.6-1.1 3.6-1.5 6-1.5v-10c-2.4 0-4.4.4-6 1.5z"
          fill="none"
          stroke="currentColor"
        />
        <path d="M8 4v10" stroke="currentColor" />
      </svg>
      <kbd class="sidebar-key">␣ur</kbd>
    </button>
  );
}
