// Read mode (09-ui.md#hint-bar-and-keystroke-overlay): ␣ur, `:read` or the headerbar's button hide
// the rail, the sidebar, the hint bar and the keystroke overlay; the same again shows them. The
// app frame carries `read-mode` while it is on (ReadMode.css hides them); it lasts for the session.
import { type Accessor, createSignal } from "solid-js";
import { currentBuffer } from "../../keys/locate";
import "./ReadMode.css";

export interface ReadMode {
  /** Whether read mode is on. */
  on: Accessor<boolean>;
  /** Turns read mode on or off. */
  toggle: () => void;
}

/** What read mode hides that can hold the focus: the rail column (rail and sidebar), the hint bar. */
const HIDDEN = ".rail, .hint-bar-host";

/** Takes the focus out of what read mode hides: into the lecture when one is open, else the page. */
function leaveHidden(): void {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.closest(HIDDEN)) return;
  const buffer = currentBuffer();
  if (buffer) buffer.focus();
  else active.blur();
}

export function createReadMode(): ReadMode {
  const [on, setOn] = createSignal(false);
  return {
    on,
    toggle: () => {
      setOn(!on());
      // Only going in can hide the focus: what read mode hides can't hold it while it is on.
      leaveHidden();
    },
  };
}
