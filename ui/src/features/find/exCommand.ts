// `:find <words>` (10-keymap.md#commands): an Ex command of @replit/codemirror-vim, so `:` in the
// lecture buffer opens Vim's command line and `:find covariance` (or `:fin`) runs a search. Vim's
// Ex table is global, so the command is defined once per page and calls whichever handler the
// app set last.
import { Vim } from "@replit/codemirror-vim";

type ExFn = Parameters<typeof Vim.defineEx>[2];

/** The parts of Vim's API registration uses: the real `Vim`, or a recording fake in tests. */
export interface ExApi {
  defineEx(name: string, prefix: string | undefined, fn: ExFn): void;
}

/** What `:find` calls with the words typed after it, trimmed (empty for a bare `:find`). */
export type FindHandler = (words: string) => void;

let handler: FindHandler | null = null;
const registered = new WeakSet<ExApi>();

/** The Ex command's body: the words after `:find`, to the current handler. */
const findEx: ExFn = (_cm, params) => handler?.((params.argString ?? "").trim());

/**
 * Defines `:find` (shortest form `:fin`) once per Vim API and points it at `onFind`. Returns a
 * function that unsets `onFind` again if it is still the current handler.
 */
export function registerFindCommand(onFind: FindHandler, api: ExApi = Vim): () => void {
  handler = onFind;
  if (!registered.has(api)) {
    registered.add(api);
    api.defineEx("find", "fin", findEx);
  }
  return () => {
    if (handler === onFind) handler = null;
  };
}
