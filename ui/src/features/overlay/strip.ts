// The keys the keystroke overlay shows (09-ui.md#hint-bar-and-keystroke-overlay): the last keys
// typed, oldest first, and how many of the last ones the key engine still holds, a sequence or a
// count waiting for more (`␣u`, `3`, `g`). Pure: mount.tsx feeds it once per frame.

/** How many keys the overlay holds; older ones drop off the front. */
export const MAX_KEYS = 8;

export interface Strip {
  /** Key tokens (keys/notation.ts), oldest first. */
  keys: readonly string[];
  /** How many of the last `keys` the engine holds, waiting for the rest of a sequence. */
  pending: number;
}

export const EMPTY_STRIP: Strip = { keys: [], pending: 0 };

/** `strip` with the `typed` tokens after it, while the engine holds `pending` keys. */
export function addKeys(strip: Strip, typed: readonly string[], pending: number): Strip {
  const keys = strip.keys.concat(typed).slice(-MAX_KEYS);
  return { keys, pending: Math.min(pending, keys.length) };
}

/** Whether the key at `index` is one the engine still holds. */
export const isPending = (strip: Strip, index: number): boolean => index >= strip.keys.length - strip.pending;
