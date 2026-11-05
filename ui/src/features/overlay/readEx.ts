// `:read` (10-keymap.md#commands): read mode's Ex command in the lecture buffer, beside ␣ur. Vim's
// Ex table is global, so the command is defined once per page and calls whichever handler the app
// set last. Only the whole word: `:r` and `:re` stay Vim's (`:red` is redo).
import { Vim } from "@replit/codemirror-vim";
import type { ExApi } from "../find/exCommand";

let handler: (() => void) | null = null;
const registered = new WeakSet<ExApi>();

/** Defines `:read` once per Vim API and points it at `onRead`; returns the function that unsets it. */
export function registerReadCommand(onRead: () => void, api: ExApi = Vim): () => void {
  handler = onRead;
  if (!registered.has(api)) {
    registered.add(api);
    api.defineEx("read", undefined, () => handler?.());
  }
  return () => {
    if (handler === onRead) handler = null;
  };
}
