// The commands keys run (keymap.ts names them by id). The feature that does a command registers
// its handler here, from whichever chunk it lives in; until one does, the key goes on to the
// element as if it weren't bound. Handlers run on the key path: they must not wait for anything.
import type { Binding } from "./keymap";

/** What a handler gets: the count typed before the keys (1 when none) and the binding. */
export interface Invocation {
  count: number;
  /** Whether a count was typed. */
  explicit: boolean;
  binding: Binding;
}

/** Runs a command. Returning `false` declines it (no 4th course): the key goes on to the element. */
export type Handler = (call: Invocation) => boolean | undefined;

const handlers = new Map<string, Handler>();

/** Registers the handler of `command`; returns the function that removes it again. */
export function registerCommand(command: string, handler: Handler): () => void {
  handlers.set(command, handler);
  return () => {
    if (handlers.get(command) === handler) handlers.delete(command);
  };
}

/** Runs the binding's command; `false` when nobody handles it or its handler declined. */
export function runCommand(call: Invocation): boolean {
  const handler = handlers.get(call.binding.command);
  return handler ? handler(call) !== false : false;
}
