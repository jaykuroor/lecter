// Key notation (10-keymap.md): bindings are written the way Vim writes keys, and a keydown is
// turned into the same tokens, so matching is plain string equality. A token is one key press:
// a printable character as typed (`s`, `S`, `'`), or a named or modified key in angle brackets
// (`<Space>`, `<CR>`, `<C-d>`, `<C-S-p>`, `<A-Left>`; `<D-…>` is macOS Cmd). Modifiers always
// come in the order C, A, S, D. In a binding, `<leader>` is Space and `<Mod-…>` is Ctrl on
// Windows and Linux and Cmd on macOS (10-keymap.md#global-os-conventions).

/** `KeyboardEvent.key` names → token names. */
const NAMED: Record<string, string> = {
  " ": "Space",
  Enter: "CR",
  Tab: "Tab",
  Escape: "Esc",
  Backspace: "BS",
  Delete: "Del",
  Insert: "Ins",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
};

/** Names a binding may write, in any case, → their token name. */
const ALIASES: Record<string, string> = {
  space: "Space",
  leader: "Space",
  cr: "CR",
  enter: "CR",
  return: "CR",
  tab: "Tab",
  esc: "Esc",
  bs: "BS",
  del: "Del",
  ins: "Ins",
  left: "Left",
  right: "Right",
  up: "Up",
  down: "Down",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  lt: "<",
};

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "OS", "Hyper", "Super"]);

/**
 * The token a keydown stands for, or `null` for a modifier pressed on its own and keys that type
 * nothing nameable (dead keys, input method keys). Events say which modifier was held (`<C-1>` or
 * `<D-1>`); `parseKeys` turns a binding's `<Mod-…>` into the platform's one.
 */
export function eventToken(e: KeyboardEvent): string | null {
  const key = e.key;
  if (MODIFIER_KEYS.has(key)) return null;
  const named = NAMED[key] ?? (/^F\d{1,2}$/.test(key) ? key : undefined);
  if (!e.ctrlKey && !e.altKey && !e.metaKey) {
    if (named) return e.shiftKey ? `<S-${named}>` : `<${named}>`;
    // One character as typed: Shift is already in it (`S`, `?`).
    return [...key].length === 1 ? key : null;
  }
  const base = named ?? codeKey(e.code) ?? ([...key].length === 1 ? key.toLowerCase() : null);
  if (base === null) return null;
  return `<${e.ctrlKey ? "C-" : ""}${e.altKey ? "A-" : ""}${e.shiftKey ? "S-" : ""}${e.metaKey ? "D-" : ""}${base}>`;
}

/**
 * With Ctrl, Alt or Cmd held, the key's place decides: layouts that type something else on the
 * digit row (AZERTY's `&`) or letters (Cyrillic) still give `<C-1>` and `<C-p>`; the keypad's
 * digits are `k0`…`k9`. `null` for other places and for a synthetic event without a code.
 */
function codeKey(code: string): string | null {
  const m = /^(Digit|Key|Numpad)([0-9A-Z])$/.exec(code);
  if (!m) return null;
  const [, kind, ch] = m as unknown as [string, string, string];
  if (kind === "Numpad") return /\d/.test(ch) ? `k${ch}` : null;
  return ch.toLowerCase();
}

/**
 * Splits a binding's keys into tokens: `gd` → `g d`, `<leader>e` → `<Space> e`, `<C-D>` → `<C-d>`,
 * `<Mod-1>` → `<C-1>` (`<D-1>` on macOS). A `<` that starts no name is the key `<` itself (`<<`);
 * `<lt>` also is. Throws on an empty string or an unknown name, so a bad keymap entry is reported.
 */
export function parseKeys(keys: string, mac: boolean): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < keys.length) {
    const m = keys[i] === "<" ? /^<((?:[CASDcasd]-|Mod-|mod-)*)([^<>\s]+?)>/.exec(keys.slice(i)) : null;
    if (m && (m[1] || m[2] !== "<")) {
      out.push(special(m[1] as string, m[2] as string, mac, m[0]));
      i += m[0].length;
      continue;
    }
    const ch = String.fromCodePoint(keys.codePointAt(i) as number);
    out.push(ch);
    i += ch.length;
  }
  if (out.length === 0) throw new Error("empty keys");
  return out;
}

/** One `<…>` token: its modifiers in C A S D order and its key's canonical name. */
function special(mods: string, name: string, mac: boolean, raw: string): string {
  const held = new Set<string>();
  for (const part of mods.split("-")) {
    if (!part) continue;
    const mod = part.toUpperCase() === "MOD" ? (mac ? "D" : "C") : part.toUpperCase();
    held.add(mod);
  }
  const alias = ALIASES[name.toLowerCase()];
  let base: string;
  if (alias) base = alias;
  else if (/^F\d{1,2}$/i.test(name)) base = name.toUpperCase();
  else if (/^k\d$/.test(name)) base = name;
  else if ([...name].length === 1) base = held.size > 0 ? name.toLowerCase() : name;
  else throw new Error(`unknown key name ${raw}`);
  if (held.size === 0) return base.length === 1 ? base : `<${base}>`;
  const order = ["C", "A", "S", "D"].filter((m) => held.has(m)).join("-");
  return `<${order}-${base}>`;
}

/** How a token shows on a keycap: `␣`, `↵`, `Ctrl-d` (`⌘1` on macOS for Cmd), letters as typed. */
export function keyLabel(token: string, mac: boolean): string {
  const m = /^<(?:([CASD](?:-[CASD])*)-)?(.+)>$/.exec(token);
  if (!m) return token;
  const names: Record<string, string> = { Space: "␣", CR: "↵", Esc: "Esc", BS: "⌫", Left: "←", Right: "→" };
  const base = names[m[2] as string] ?? (m[2] as string);
  if (!m[1]) return base;
  const words: Record<string, string> = mac
    ? { C: "⌃", A: "⌥", S: "⇧", D: "⌘" }
    : { C: "Ctrl-", A: "Alt-", S: "Shift-", D: "Super-" };
  return m[1]
    .split("-")
    .map((mod) => words[mod])
    .join("")
    .concat(base);
}
