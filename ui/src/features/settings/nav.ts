// Keys in the Settings window (12-settings-theme-onboarding.md#settings: fully keyboard-navigable;
// F-045 criterion 3): Tab and Shift-Tab go round the window's controls (SettingsWindow.tsx keeps
// them in it); in the page list ↑/↓ and j/k pick the page; in a page j/k (and ↑/↓ on a switch or a
// button) go to the next or previous setting; `/` goes to the search; Esc empties the search, else
// closes. Choices keep the arrows for themselves (a radio group or a list changes its value with
// them), and text fields keep every letter.

/** What a key in the window does. */
export type WindowKey =
  | { do: "close" }
  | { do: "clear" }
  | { do: "search" }
  | { do: "page"; by: 1 | -1 | "first" | "last" }
  | { do: "row"; by: 1 | -1 }
  | null;

/** Fields a letter types into. */
const TYPES_TEXT = 'input[type="text"], input[type="search"], input:not([type]), textarea';
/** Controls that use ↑/↓ for their own value. */
const OWN_ARROWS = 'input[type="radio"], select';

/**
 * What `e`, a keydown on `target` in the window, does, given whether the search holds text.
 * `null`: the key goes on as usual.
 */
export function windowKey(e: KeyboardEvent, target: Element, searchHasText: boolean): WindowKey {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  const search = target.matches(".settings-search");
  if (e.key === "Escape") return search && searchHasText ? { do: "clear" } : { do: "close" };
  if (target.matches(TYPES_TEXT)) {
    // From the search, ↓ (or Enter) goes into the settings found.
    if (search && (e.key === "ArrowDown" || e.key === "Enter")) return { do: "row", by: 1 };
    return null;
  }
  if (e.key === "/") return { do: "search" };
  const down = e.key === "j" || e.key === "ArrowDown";
  const up = e.key === "k" || e.key === "ArrowUp";
  if (target.getAttribute("role") === "tab") {
    if (down) return { do: "page", by: 1 };
    if (up) return { do: "page", by: -1 };
    if (e.key === "Home") return { do: "page", by: "first" };
    if (e.key === "End") return { do: "page", by: "last" };
    return null;
  }
  if (!target.closest(".settings-panel")) return null;
  const arrows = e.key === "ArrowDown" || e.key === "ArrowUp";
  if (arrows && target.matches(OWN_ARROWS)) return null;
  if (down) return { do: "row", by: 1 };
  if (up) return { do: "row", by: -1 };
  return null;
}

/** Where the focus goes in a setting's row: its picked choice, else its first control, else the row. */
export function rowTarget(row: HTMLElement): HTMLElement {
  const picked = row.querySelector<HTMLElement>('input[type="radio"]:checked:not([disabled])');
  const first = row.querySelector<HTMLElement>(
    ".settings-control input:not([disabled]), .settings-control select:not([disabled]), .settings-control button:not([disabled])",
  );
  return picked ?? first ?? row;
}

/**
 * The row `by` after the one holding `from` in `panel` (the first row when `from` is in none),
 * kept within the rows; none when the panel has none.
 */
export function nextRow(panel: Element, from: Element, by: 1 | -1): HTMLElement | undefined {
  const rows = [...panel.querySelectorAll<HTMLElement>(".settings-row")];
  // Not in a row: -1, so one step either way is the first row.
  const at = rows.findIndex((r) => r.contains(from));
  return rows[Math.min(rows.length - 1, Math.max(0, at + by))];
}
