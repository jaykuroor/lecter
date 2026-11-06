// The key engine at work in the page (10-keymap.md): each keydown, before any element sees it,
// becomes a token, goes through the engine for where the focus is, and is taken, held or let
// through. Loaded right after the first paint (boot.ts). Everything here is synchronous.
import { registerCommand, runCommand } from "./commands";
import { vimTakes } from "./dispatch";
import { compileKeymap, KeyEngine, unhandled } from "./engine";
import { type Binding, DEFAULT_KEYMAP } from "./keymap";
import { locate, type Where } from "./locate";
import { eventToken } from "./notation";
import { cyclePanes } from "./panes";
import { mergeKeymap, parseUserKeymap } from "./user";
import { createWhichKey, type WhichKey } from "./WhichKey";

export interface Keys {
  engine: KeyEngine;
  /** Handles one keydown (boot.ts calls it for every key once the engine is in). */
  handle: (e: KeyboardEvent) => void;
  /** Problems found in keymaps.jsonc and clashes between bindings. */
  warnings: string[];
  /**
   * Lays keymaps.jsonc's text (null: no file) over the defaults from now on, replacing any earlier
   * file's bindings; returns its problems and clashes. The defaults stay when it has none to use.
   */
  setUserKeymap: (text: string | null) => string[];
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
  /** The keymap for keymaps.jsonc's `text`, and what was wrong with it. */
  const build = (text: string | null) => {
    const user = text ? parseUserKeymap(text, opts.mac) : { bindings: [], warnings: [] };
    const merged = mergeKeymap(DEFAULT_KEYMAP, user.bindings, opts.mac);
    return { map: compileKeymap(merged.bindings, opts.mac), warnings: user.warnings.concat(merged.warnings) };
  };
  const first = build(opts.userKeymap ?? null);
  const engine = new KeyEngine(first.map);
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
      // A given-up Vim key whose Lecter command isn't there yet does nothing in the buffer: left
      // to the editor, Enter would still move a line down and Tab leave the buffer.
      const sequence = out.explicit ? out.keys.slice(String(out.count).length) : out.keys;
      if (where.buffer && !vimTakes(sequence)) {
        take(e);
        return;
      }
      out = unhandled(out);
    }
    if (out.kind === "pending") take(e);
    else if (out.kind === "miss") {
      where.buffer?.replay(out.replay);
      if (out.take) take(e);
    }
  };
  // F6 / Shift-F6 move between panes (D-200); with nowhere to go the key goes on.
  const dropPanes = [
    registerCommand("focus.next", () => cyclePanes(document, 1)),
    registerCommand("focus.prev", () => cyclePanes(document, -1)),
  ];
  // A click elsewhere ends whatever was pending.
  const drop = (e: Event) => {
    if (!whichKey.contains(e.target)) engine.reset();
  };
  window.addEventListener("pointerdown", drop, { capture: true });
  return {
    engine,
    handle,
    warnings: first.warnings,
    setUserKeymap: (text) => {
      const next = build(text);
      // A key typed while the file was being read (a ␣ held back at boot) stays pending: the next
      // key is read on the new keymap, which breaks the sequence off if it no longer goes on.
      // Which-key hears of it, so what it shows is the new keymap's.
      engine.map = next.map;
      engine.onChange(engine.pending());
      return next.warnings;
    },
    whichKey,
    stop: () => {
      window.removeEventListener("pointerdown", drop, { capture: true });
      for (const d of dropPanes) d();
      whichKey.dispose();
    },
  };
}
