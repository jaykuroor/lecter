// keymaps.jsonc (12-settings-theme-onboarding.md#settings): the user's bindings, laid over the
// defaults. Proposed format (NEEDS_MAINTAINER; see the F-037 report):
//
//   {
//     "version": 1,
//     "bindings": [
//       { "keys": "<leader>e", "command": "sidebar.toggle", "context": "app" },
//       { "keys": "gd", "command": null, "context": "line" }   // null: unbind
//     ]
//   }
//
// `context` is a scope (keymap.ts; `global` when left out), `modes` an optional list of modes.
// Everything wrong in the file is reported, never thrown: the defaults still work.
import { type Binding, DEFAULT_KEYMAP, type Mode, SCOPES, type Scope } from "./keymap";
import { parseKeys } from "./notation";

/** One entry of keymaps.jsonc: a binding, or `command: null` to remove one. */
export interface UserBinding {
  keys: string;
  command: string | null;
  context: Scope;
  modes?: Mode[];
}

/** keymaps.jsonc is a small hand-written file; anything larger is refused unread. */
const MAX_BYTES = 256 * 1024;
const MAX_BINDINGS = 2000;
const MODES: readonly Mode[] = ["normal", "visual", "insert"];

/** JSONC → JSON: drops comments and trailing commas, leaving strings alone. */
export function stripJsonc(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      const end = stringEnd(text, i);
      out += text.slice(i, end);
      i = end;
    } else if (c === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      i = nl === -1 ? text.length : nl;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/** The index just past the string that starts at `from` (a `"`). */
function stringEnd(text: string, from: number): number {
  let i = from + 1;
  while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
  return Math.min(i + 1, text.length);
}

/** Reads keymaps.jsonc's text: its bindings, and a warning for each thing it got wrong. */
export function parseUserKeymap(text: string, mac: boolean): { bindings: UserBinding[]; warnings: string[] } {
  const warnings: string[] = [];
  if (text.length > MAX_BYTES)
    return { bindings: [], warnings: [`keymaps.jsonc is larger than ${MAX_BYTES} bytes; not read`] };
  let doc: unknown;
  try {
    doc = JSON.parse(stripJsonc(text));
  } catch {
    return { bindings: [], warnings: ["keymaps.jsonc is not valid JSONC; not read"] };
  }
  const root = (doc ?? {}) as { version?: unknown; bindings?: unknown };
  if (root.version !== 1 || !Array.isArray(root.bindings)) {
    return { bindings: [], warnings: ['keymaps.jsonc needs "version": 1 and a "bindings" list; not read'] };
  }
  const bindings: UserBinding[] = [];
  root.bindings.slice(0, MAX_BINDINGS).forEach((entry: unknown, i: number) => {
    const b = checkEntry(entry, mac);
    if (typeof b === "string") warnings.push(`keymaps.jsonc binding ${i + 1}: ${b}; ignored`);
    else bindings.push(b);
  });
  if (root.bindings.length > MAX_BINDINGS)
    warnings.push(`keymaps.jsonc has more than ${MAX_BINDINGS} bindings; the rest are ignored`);
  return { bindings, warnings };
}

/** The commands a binding may name: every one the default keymap has (10-keymap.md). */
const KNOWN_COMMANDS: ReadonlySet<string> = new Set(
  DEFAULT_KEYMAP.map((b) => b.command).filter((c) => !c.startsWith("+")),
);

/** One entry, checked; a string says what is wrong with it. */
function checkEntry(entry: unknown, mac: boolean): UserBinding | string {
  if (typeof entry !== "object" || entry === null) return "not an object";
  const e = entry as Record<string, unknown>;
  if (typeof e.keys !== "string") return '"keys" must be a string';
  try {
    parseKeys(e.keys, mac);
  } catch (err) {
    return `"keys" ${JSON.stringify(e.keys)}: ${(err as Error).message}`;
  }
  if (e.command !== null && (typeof e.command !== "string" || e.command === "" || e.command.startsWith("+"))) {
    return '"command" must be a command id or null';
  }
  if (e.command !== null && !KNOWN_COMMANDS.has(e.command)) return `unknown command ${JSON.stringify(e.command)}`;
  const context = e.context ?? "global";
  if (!SCOPES.includes(context as Scope)) return `unknown "context" ${JSON.stringify(context)}`;
  const out: UserBinding = { keys: e.keys, command: e.command, context: context as Scope };
  if (e.modes !== undefined) {
    if (!Array.isArray(e.modes) || e.modes.length === 0 || !e.modes.every((m) => MODES.includes(m as Mode))) {
      return '"modes" must list normal, visual or insert';
    }
    out.modes = e.modes as Mode[];
  }
  return out;
}

/** A binding's identity in its scope: its keys as tokens. */
const id = (b: { keys: string }, mac: boolean): string => parseKeys(b.keys, mac).join(" ");

/** How a binding reads in a warning. */
const show = (b: { keys: string; command: string }): string => `${b.keys} (${b.command})`;

/**
 * The defaults, then the user's bindings in order: one with the same keys in the same context
 * replaces the default (a rebind), `null` removes it. Two user bindings with the same keys in one
 * context, or any two bindings there where one's keys start the other's, clash: a warning lists both.
 */
export function mergeKeymap(
  defaults: readonly Binding[],
  user: readonly UserBinding[],
  mac: boolean,
): { bindings: Binding[]; warnings: string[] } {
  const warnings: string[] = [];
  let bindings = [...defaults];
  const fromUser = new Map<string, Binding>();
  for (const u of user) {
    const key = `${u.context} ${id(u, mac)}`;
    const earlier = fromUser.get(key);
    if (earlier && u.command !== null) {
      warnings.push(`Keys clash in ${u.context}: ${show(earlier)} and ${show({ keys: u.keys, command: u.command })}`);
    }
    bindings = bindings.filter((b) => b.command.startsWith("+") || b.scope !== u.context || id(b, mac) !== id(u, mac));
    fromUser.delete(key);
    if (u.command === null) continue;
    const b: Binding = { keys: u.keys, command: u.command, scope: u.context, desc: u.command };
    if (u.modes) b.modes = u.modes;
    bindings.push(b);
    fromUser.set(key, b);
  }
  return { bindings, warnings: warnings.concat(prefixClashes(bindings, mac)) };
}

/** Pairs of bindings in one scope where one's keys start the other's (the longer one waits). */
export function prefixClashes(bindings: readonly Binding[], mac: boolean): string[] {
  const out: string[] = [];
  const runs = bindings.filter((b) => !b.command.startsWith("+"));
  const tokens = runs.map((b) => id(b, mac));
  runs.forEach((a, i) => {
    runs.forEach((b, j) => {
      // A binding never starts itself: its keys have no trailing space.
      if (a.scope === b.scope && (tokens[j] as string).startsWith(`${tokens[i]} `)) {
        out.push(`Keys clash in ${a.scope}: ${show(a)} and ${show(b)}`);
      }
    });
  });
  return out;
}
