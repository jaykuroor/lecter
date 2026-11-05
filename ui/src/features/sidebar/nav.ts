/**
 * Moving through a list of rows by key (09-ui.md#slack-and-discord-behaviours): `j` / ↓ next,
 * `k` / ↑ previous, `gg` / Home first, `G` / End last. The caller checks modifiers first and
 * focuses the row; Enter belongs to the row.
 */

/** What a key does: the row to go to, `"pending"` for the first `g` of `gg`, or `null` (not a move). */
export type RowMove = number | "pending" | null;

/** A key-to-row function that remembers a pending `g` between keys. */
export function createRowMoves(): (key: string, index: number, count: number) => RowMove {
  let g = false;
  return (key, index, count) => {
    const after = g;
    g = false;
    if (count === 0) return null;
    const last = count - 1;
    switch (key) {
      case "j":
      case "ArrowDown":
        return Math.min(index + 1, last);
      case "k":
      case "ArrowUp":
        return Math.max(index - 1, 0);
      case "Home":
        return 0;
      case "End":
      case "G":
        return last;
      case "g":
        if (after) return 0;
        g = true;
        return "pending";
      default:
        return null;
    }
  };
}
