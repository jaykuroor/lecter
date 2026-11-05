// The key engine (10-keymap.md): modes, multi-key sequences and counts, with bindings that depend
// on the focused element. It is synchronous and pure: keys come in as tokens (notation.ts) with
// where the focus is, and each one gets an answer at once. Nothing here awaits anything
// (keystroke_p99_ms, ui/CLAUDE.md: never await the core on the key path).
import { type Binding, bindingModes, type Mode, SCOPES, type Scope } from "./keymap";
import { parseKeys } from "./notation";

/**
 * What has the focus, as far as keys go: a line of the lecture buffer (`slide-line`, `note-line`,
 * `gloss`), a text field (`field`: inputs, the buffer's `:` and `/` prompts), a control that Space
 * and Enter activate (`control`: buttons, links, rows; Q-030), or anything else (`page`).
 */
export type Element = "slide-line" | "note-line" | "gloss" | "field" | "control" | "page";

/** Whether the element is a line of the lecture buffer, where Vim runs and counts work. */
export const inBuffer = (el: Element): boolean => el === "slide-line" || el === "note-line" || el === "gloss";

/**
 * The scopes that apply, most specific first. In insert mode, a text field or on a control only
 * the global keys apply: everything else types or activates as usual. A slide line and an own-note
 * line share the `line` scope, so their keys mean the same on both (10-keymap.md#on-a-slide-line).
 */
export function scopesFor(el: Element, mode: Mode): readonly Scope[] {
  if (mode === "insert" || el === "field" || el === "control") return ["global"];
  if (el === "page") return ["app", "global"];
  return [el === "gloss" ? "gloss" : "line", "buffer", "app", "global"];
}

/** A node of a scope's key tree: the binding the keys so far name, and the keys that go on. */
interface Node {
  binding?: Binding;
  next: Map<string, Node>;
  /** A leader group's name (`+ai`), for which-key. */
  group?: Binding;
}

/** The bindings, compiled to one key tree per scope. */
export interface Keymap {
  bindings: readonly Binding[];
  trees: ReadonlyMap<Scope, Node>;
  mac: boolean;
}

/** Compiles `bindings`; a binding whose keys don't parse is left out (user.ts reports it first). */
export function compileKeymap(bindings: readonly Binding[], mac: boolean): Keymap {
  const trees = new Map<Scope, Node>(SCOPES.map((s) => [s, { next: new Map() }]));
  for (const b of bindings) {
    let tokens: string[];
    try {
      tokens = parseKeys(b.keys, mac);
    } catch {
      continue;
    }
    let node = trees.get(b.scope) as Node;
    for (const t of tokens) {
      let child = node.next.get(t);
      if (!child) {
        child = { next: new Map() };
        node.next.set(t, child);
      }
      node = child;
    }
    if (b.command.startsWith("+")) node.group = b;
    else node.binding = b;
  }
  return { bindings, trees, mac };
}

/** The node `tokens` lead to in `scope`'s tree, if any. */
function walk(map: Keymap, scope: Scope, tokens: readonly string[]): Node | undefined {
  let node = map.trees.get(scope);
  for (const t of tokens) node = node?.next.get(t);
  return node;
}

/**
 * The binding `tokens` name for an element in a mode, the most specific scope first; `null` when
 * none does. This is what a key means there (criterion: a slide line and an own note agree).
 */
export function resolve(map: Keymap, el: Element, mode: Mode, tokens: readonly string[]): Binding | null {
  for (const scope of scopesFor(el, mode)) {
    const b = walk(map, scope, tokens)?.binding;
    if (b && bindingModes(b).includes(mode)) return b;
  }
  return null;
}

/** One entry which-key shows: the next key, and the binding or group it leads to. */
export interface Choice {
  key: string;
  binding: Binding;
  group: boolean;
}

/** What can follow `prefix` here: bindings and groups, the most specific scope winning a key. */
export function choices(map: Keymap, el: Element, mode: Mode, prefix: readonly string[]): Choice[] {
  const seen = new Map<string, Choice>();
  for (const scope of scopesFor(el, mode)) {
    const node = walk(map, scope, prefix);
    if (!node) continue;
    for (const [key, child] of node.next) {
      if (seen.has(key)) continue;
      if (child.binding && bindingModes(child.binding).includes(mode))
        seen.set(key, { key, binding: child.binding, group: false });
      else if (child.group) seen.set(key, { key, binding: child.group, group: true });
    }
  }
  return [...seen.values()];
}

/** Whether some binding here starts with `tokens` and goes on. */
function goesOn(map: Keymap, el: Element, mode: Mode, tokens: readonly string[]): boolean {
  return scopesFor(el, mode).some((scope) => {
    const node = walk(map, scope, tokens);
    return node !== undefined && [...node.next.values()].some((n) => hasBinding(n, mode));
  });
}

/** Whether the subtree under `node` holds a binding for `mode`. */
function hasBinding(node: Node, mode: Mode): boolean {
  if (node.binding && bindingModes(node.binding).includes(mode)) return true;
  for (const child of node.next.values()) if (hasBinding(child, mode)) return true;
  return false;
}

/**
 * The engine's answer to one key:
 * - `run`: a binding matched; the caller runs its command (and takes the key if it ran);
 * - `pending`: the key starts or continues a sequence or a count; the caller takes it;
 * - `miss`: a sequence broke off. `replay` holds the keys the engine took that the element should
 *   have had (a count, `g`, `]`), to hand to Vim in order; `take` says whether this key goes too
 *   (after the leader, a letter is dropped, as which-key does; Esc cancels);
 * - `pass`: not the engine's; the element handles the key.
 */
export type Outcome =
  | { kind: "run"; binding: Binding; count: number; explicit: boolean; keys: string[] }
  | { kind: "pending" }
  | { kind: "miss"; replay: string[]; take: boolean }
  | { kind: "pass" };

const LEADER = "<Space>";
const DIGITS: ReadonlySet<string> = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
const BUFFER_SCOPES: ReadonlySet<Scope> = new Set(["buffer", "line", "gloss"]);

/** Whether `keys` (a count, then a sequence) start with the leader. */
const afterLeader = (keys: readonly string[]): boolean => keys.find((k) => !DIGITS.has(k)) === LEADER;

/** Whether a token types one character (`e`, `?`), as opposed to a named or modified key. */
const printable = (token: string): boolean => [...token].length === 1;

/**
 * A `run` whose command nobody handles (its feature isn't there, or it declined: no 4th course):
 * the key goes on as if the binding weren't there. After the leader that drops it, as `breakOff`
 * does; otherwise the count and keys before it go back to the element and it follows them.
 */
export function unhandled(run: { keys: readonly string[] }): Outcome {
  const last = run.keys[run.keys.length - 1] as string;
  if (afterLeader(run.keys)) return { kind: "miss", replay: [], take: printable(last) };
  return { kind: "miss", replay: run.keys.slice(0, -1), take: false };
}

/** The state between keys: the count and the keys typed so far. */
export class KeyEngine {
  private count = "";
  private keys: string[] = [];
  /** Called with the pending keys whenever they change (`[]` once nothing is pending). */
  onChange: (pending: readonly string[]) => void = () => {};

  constructor(public map: Keymap) {}

  /** The keys typed so far, count first. */
  pending(): string[] {
    return this.count ? [...this.count, ...this.keys] : [...this.keys];
  }

  /** The keys of the sequence typed so far, without the count. */
  sequence(): string[] {
    return [...this.keys];
  }

  /** Forgets a pending count or sequence (focus moved, an input method started). */
  reset(): void {
    if (!this.count && this.keys.length === 0) return;
    this.count = "";
    this.keys = [];
    this.onChange([]);
  }

  /** Continues a pending sequence with `prefix` (which-key: a group picked with the mouse). */
  setPrefix(prefix: readonly string[]): void {
    this.keys = [...prefix];
    this.onChange(this.pending());
  }

  /** One key: `token` pressed on `el` in `mode`; `repeat` when the key is held down. */
  feed(token: string, el: Element, mode: Mode, repeat = false): Outcome {
    const idle = !this.count && this.keys.length === 0;
    if (!idle && token === "<Esc>") {
      this.reset();
      return { kind: "miss", replay: [], take: true };
    }
    // A count: in the buffer, before any key of a sequence (`3]]`); `0` only goes on a count.
    if (this.keys.length === 0 && inBuffer(el) && mode !== "insert" && !repeat && DIGITS.has(token)) {
      if (token !== "0" || this.count) {
        this.count += token;
        this.onChange(this.pending());
        return { kind: "pending" };
      }
    }
    const keys = [...this.keys, token];
    const binding = resolve(this.map, el, mode, keys);
    const more = goesOn(this.map, el, mode, keys);
    // A held key never starts a sequence (a held Space is not a leader), and repeats only the
    // buffer's own keys (a held Ctrl-j goes on through the slides; a held Ctrl-1 opens once).
    if (idle && repeat && (more || !binding || !BUFFER_SCOPES.has(binding.scope))) return { kind: "pass" };
    if (binding && !more) {
      const out: Outcome = {
        kind: "run",
        binding,
        count: Number(this.count || "1"),
        explicit: this.count !== "",
        keys: this.pending().concat(token),
      };
      this.count = "";
      this.keys = [];
      this.onChange([]);
      return out;
    }
    if (more) {
      this.keys = keys;
      this.onChange(this.pending());
      return { kind: "pending" };
    }
    if (idle) return { kind: "pass" };
    return this.breakOff(token);
  }

  /**
   * A pending sequence that `token` doesn't continue. After the leader nothing goes back to the
   * element, and a printable key goes with it; otherwise the count and keys go back in order and
   * `token` follows them.
   */
  breakOff(token: string): Outcome {
    const out = unhandled({ keys: [...this.pending(), token] });
    this.count = "";
    this.keys = [];
    this.onChange([]);
    return out;
  }
}
