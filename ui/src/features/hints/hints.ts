// What the hint bar lists (09-ui.md#hint-bar-and-keystroke-overlay): the keys that work now, for
// the element the cursor is on and the mode. It reads the key engine's own keymap, user bindings
// from keymaps.jsonc included (D-199), and keeps a binding only where the engine would run it, so
// the bar never disagrees with what a key does. No second key table.
import { type Element, type Keymap, resolve, scopesFor } from "../../keys/engine";
import { type Binding, DEFAULT_KEYMAP, type Mode, type Scope } from "../../keys/keymap";
import { keyLabel, parseKeys } from "../../keys/notation";

const LEADER = "<Space>";

/** One entry of the hint bar: a command with every key that runs it here. */
export interface Hint {
  /** The keycaps, most specific scope first; numbered keys in a row read as one range (`Ctrl-1…9`). */
  keys: string[];
  /** What it does. */
  desc: string;
  /** The binding a click runs; `null` for the leader's entry, which opens which-key instead. */
  binding: Binding | null;
  /** The keys a click leaves pending (the leader's entry: `␣`), empty for the rest. */
  prefix: string[];
  /** The scope the hint comes from, for its mouse action (mouse.ts). */
  scope: Scope;
}

/**
 * The hint bar's two parts: `main` holds the element's own keys, then the buffer's moves (cut to
 * the line when they don't fit), `tail` the global keys and the leader, always shown at the end.
 */
export interface Hints {
  main: Hint[];
  tail: Hint[];
}

/** Where a command first comes in the default keymap: the spec's order. User-only commands go last. */
const RANK = new Map<string, number>();
DEFAULT_KEYMAP.forEach((b, i) => {
  if (!RANK.has(b.command)) RANK.set(b.command, i);
});
const rank = (command: string): number => RANK.get(command) ?? DEFAULT_KEYMAP.length;

/** A command's words: its own, else the default keymap's (keymaps.jsonc bindings have only the id). */
function wordsFor(bindings: readonly Binding[]): string {
  const named = bindings.find((b) => b.desc !== b.command);
  const desc = named?.desc ?? DEFAULT_KEYMAP.find((b) => b.command === bindings[0]?.command)?.desc;
  if (desc === undefined) return (bindings[0] as Binding).command;
  // A numbered family (Course 1…9) is named once.
  return bindings[0]?.arg === undefined ? desc : desc.replace(/\s*\d+$/, "");
}

/** `Ctrl-1` and `Ctrl-9` → `Ctrl-1…9`. */
function range(first: string, last: string): string {
  let same = 0;
  while (same < first.length && first[same] === last[same]) same++;
  return `${first}…${last.slice(same)}`;
}

/** The keycaps of one command: one per binding, numbered bindings in a row joined into a range. */
function keycaps(bindings: readonly Binding[], labels: ReadonlyMap<Binding, string>): string[] {
  if (bindings[0]?.arg === undefined) return bindings.map((b) => labels.get(b) as string);
  const sorted = [...bindings].sort((a, b) => (a.arg as number) - (b.arg as number));
  const out: string[] = [];
  let start = 0;
  for (let i = 1; i <= sorted.length; i++) {
    const next = sorted[i];
    const prev = sorted[i - 1] as Binding;
    if (next !== undefined && (next.arg as number) === (prev.arg as number) + 1) continue;
    const first = labels.get(sorted[start] as Binding) as string;
    out.push(i - start === 1 ? first : range(first, labels.get(prev) as string));
    start = i;
  }
  return out;
}

/** The hint bar for element `el` in `mode`, from the engine's keymap `map`. */
export function hintsFor(map: Keymap, el: Element, mode: Mode): Hints {
  const scopes = scopesFor(el, mode);
  // Each command's bindings that run here, by the scope that wins (most specific first).
  const byCommand = new Map<string, Binding[]>();
  const labels = new Map<Binding, string>();
  let leader = false;
  for (const b of map.bindings) {
    if (b.command.startsWith("+")) continue;
    let tokens: string[];
    try {
      tokens = parseKeys(b.keys, map.mac);
    } catch {
      continue;
    }
    if (resolve(map, el, mode, tokens) !== b) continue;
    if (tokens[0] === LEADER) {
      leader = true;
      continue;
    }
    labels.set(b, tokens.map((t) => keyLabel(t, map.mac)).join(""));
    const list = byCommand.get(b.command);
    if (list) list.push(b);
    else byCommand.set(b.command, [b]);
  }
  const hints: Hint[] = [];
  for (const bindings of byCommand.values()) {
    bindings.sort((a, b) => scopes.indexOf(a.scope) - scopes.indexOf(b.scope));
    const first = bindings[0] as Binding;
    hints.push({
      keys: keycaps(bindings, labels),
      desc: wordsFor(bindings),
      binding: first,
      prefix: [],
      scope: first.scope,
    });
  }
  hints.sort(
    (a, b) =>
      scopes.indexOf(a.scope) - scopes.indexOf(b.scope) ||
      rank((a.binding as Binding).command) - rank((b.binding as Binding).command),
  );
  const tail = hints.filter((h) => h.scope === "global");
  if (leader)
    tail.push({ keys: [keyLabel(LEADER, map.mac)], desc: "More", binding: null, prefix: [LEADER], scope: "app" });
  return { main: hints.filter((h) => h.scope !== "global"), tail };
}
