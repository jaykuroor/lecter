// What a binding does when no handler runs its command (its feature isn't there yet, or it
// declined): typed in the buffer, its keys go on to Vim as if the binding weren't there, except a
// given-up Vim key alone (10-keymap.md#vim-subset-kept), which does nothing there; anywhere else
// the key goes on to the element. The key path (install.ts) and a click on a hint (the hint bar)
// share it, so a key and its mouse way do the same.
import { runCommand } from "./commands";
import { type Binding, VIM_GIVEN_UP } from "./keymap";
import type { BufferTarget } from "./locate";

/** Whether `keys` (tokens, without a count), with no handler, go on to Vim in the buffer. */
export function vimTakes(keys: readonly string[]): boolean {
  return keys.length !== 1 || !VIM_GIVEN_UP.includes(keys[0] as string);
}

/**
 * Runs `binding` (its keys as tokens) without a keydown, as a click does: its handler, else, with
 * the lecture `buffer` in focus, Vim gets its keys. Whether anything ran.
 */
export function runWithoutKey(binding: Binding, keys: readonly string[], buffer: BufferTarget | null): boolean {
  if (runCommand({ binding, count: 1, explicit: false })) return true;
  if (!buffer || !vimTakes(keys)) return false;
  buffer.replay(keys);
  return true;
}
