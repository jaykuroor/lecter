import type { JSX } from "solid-js";
import "./SidebarToggle.css";

/**
 * The headerbar's sidebar button (docs/design/components.md#headerbar, left controls: a 34px icon
 * button, radius 7px) with its key as a keycap. `␣e` is the key engine's `sidebar.toggle` (App.tsx).
 */
export function SidebarToggle(props: { shown: boolean; onToggle: () => void }): JSX.Element {
  return (
    <button
      type="button"
      class="sidebar-toggle"
      aria-label="Sidebar"
      aria-expanded={props.shown ? "true" : "false"}
      aria-controls="sidebar"
      aria-keyshortcuts="Space e"
      title={props.shown ? "Hide the sidebar (␣e)" : "Show the sidebar (␣e)"}
      onClick={() => props.onToggle()}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        props.onToggle();
      }}
    >
      <svg class="sidebar-toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" />
        <path d="M6 2.5v11" stroke="currentColor" />
      </svg>
      <kbd class="sidebar-key">␣e</kbd>
    </button>
  );
}
