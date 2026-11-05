// The key engine at work in the page (10-keymap.md): each keydown, before any element sees it,
// becomes a token, goes through the engine for where the focus is, and is taken, held or let
// through. Loaded right after the first paint (boot.ts). Everything here is synchronous.
import { runCommand } from "./commands";
import { compileKeymap, KeyEngine, unhandled } from "./engine";
import { type Binding, DEFAULT_KEYMAP } from "./keymap";
import { locate, type Where } from "./locate";
import { eventToken } from "./notation";
import { mergeKeymap, parseUserKeymap } from "./user";
import { createWhichKey, type WhichKey } from "./WhichKey";

export interface Keys {
  engine: KeyEngine;
  /** Handles one keydown (boot.ts calls it for every key once the engine is in). */
  handle: (e: KeyboardEvent) => void;
  /** Problems found in keymaps.jsonc and clashes between bindings. */
  warnings: string[];
  whichKey: WhichKey;
  stop: () => void;
}

/** Takes a key from the page: no element sees it, and the browser does nothing with it. */
function take(e: Event): void {
  e.preventDefault();
  e.stopPropagation();
}

/**
 * Starts the engine: the default keymap, then `userKeymap` (keymaps.jsonc's text, when there is
 * one); which-key shows in `host`. Clashes and file problems are returned as warnings.
 */
export function startKeys(opts: { mac: boolean; host: HTMLElement; userKeymap?: string | null }): Keys {
  const user = opts.userKeymap ? parseUserKeymap(opts.userKeymap, opts.mac) : { bindings: [], warnings: [] };
  const merged = mergeKeymap(DEFAULT_KEYMAP, user.bindings, opts.mac);
  const engine = new KeyEngine(compileKeymap(merged.bindings, opts.mac));
  let where: Where = locate(null);

  /** Runs a binding (by key or from which-key); `false` when nobody handled it. */
  const run = (binding: Binding, count: number, explicit: boolean): boolean => runCommand({ binding, count, explicit });
  const whichKey = createWhichKey({ engine, host: opts.host, mac: opts.mac, where: () => where, run });

  const handle = (e: KeyboardEvent) => {
    if (e.isComposing || e.key === "Process") {
      engine.reset();
      return;
    }
    const token = eventToken(e);
    if (token === null) return;
    where = locate(e.target);
    let out = engine.feed(token, where.el, where.mode, e.repeat);
    if (out.kind === "run") {
      if (run(out.binding, out.count, out.explicit)) {
        take(e);
        return;
      }
      out = unhandled(out);
    }
    if (out.kind === "pending") take(e);
    else if (out.kind === "miss") {
      if (out.replay.length > 0) where.buffer?.replay(out.replay);
      if (out.take) take(e);
    }
  };
  // A click elsewhere ends whatever was pending.
  const drop = (e: Event) => {
    if (!whichKey.contains(e.target)) engine.reset();
  };
  window.addEventListener("pointerdown", drop, { capture: true });
  return {
    engine,
    handle,
    warnings: user.warnings.concat(merged.warnings),
    whichKey,
    stop: () => {
      window.removeEventListener("pointerdown", drop, { capture: true });
      whichKey.dispose();
    },
  };
}
