// What the command palette and the quick switcher list (09-ui.md#slack-and-discord-behaviours).
// The palette lists every command of the key engine's own keymap (keymaps.jsonc included) with
// every key that runs it, so it never disagrees with the keys; the switcher lists the courses on
// the rail and the open course's lectures, lists and sources, as the sidebar shows them.
import type { CourseOpened, KnownCourse } from "../../core/course";
import { type Binding, DEFAULT_KEYMAP, type Scope } from "../../keys/keymap";
import { keyLabel, parseKeys } from "../../keys/notation";

/** One command in the palette. */
export interface CommandEntry {
  /** Unique: the command, and its argument for a numbered one (Course 3). */
  id: string;
  title: string;
  /** Each binding's keys as one keycap label (`Ctrl-j`, `]]`, `␣ag`), in keymap order. */
  keys: string[];
  /** Where it works, for commands that need the cursor somewhere (empty: anywhere). */
  where: string;
  /** The binding a pick runs (its first one), and that binding's keys as tokens. */
  binding: Binding;
  tokens: string[];
}

const WHERE: Readonly<Record<Scope, string>> = {
  global: "",
  app: "",
  buffer: "in the lecture",
  line: "on a line",
  gloss: "on a gloss",
};

/** A command's words: its own, else the default keymap's (keymaps.jsonc bindings have only the id). */
function titleOf(bindings: readonly Binding[]): string {
  const first = bindings[0] as Binding;
  const named = bindings.find((b) => b.desc !== b.command);
  if (named) return named.desc;
  const known = DEFAULT_KEYMAP.find((b) => b.command === first.command && b.arg === first.arg);
  return known?.desc ?? first.command;
}

/** Every command of `bindings` (leader groups left out), in the keymap's order, with its keys. */
export function commandEntries(bindings: readonly Binding[], mac: boolean): CommandEntry[] {
  const groups = new Map<string, { bindings: Binding[]; keys: string[]; tokens: string[] }>();
  for (const b of bindings) {
    if (b.command.startsWith("+")) continue;
    let tokens: string[];
    try {
      tokens = parseKeys(b.keys, mac);
    } catch {
      continue;
    }
    const id = b.arg === undefined ? b.command : `${b.command}#${b.arg}`;
    const label = tokens.map((t) => keyLabel(t, mac)).join("");
    const group = groups.get(id);
    if (group) {
      group.bindings.push(b);
      group.keys.push(label);
    } else groups.set(id, { bindings: [b], keys: [label], tokens });
  }
  return [...groups].map(([id, g]) => {
    const binding = g.bindings[0] as Binding;
    return { id, title: titleOf(g.bindings), keys: g.keys, where: WHERE[binding.scope], binding, tokens: g.tokens };
  });
}

/** One place the switcher jumps to. */
export interface SwitchEntry {
  id: string;
  kind: "course" | "lecture" | "list" | "source";
  label: string;
  /** Shown beside it: the course's folder, a lecture's course, a list's key, a source's path. */
  detail: string;
  /** A course's path, a lecture's or source's course-relative path, a list's command. */
  target: string;
  /** A course whose folder is gone can't be opened (09-ui.md#course-rail). */
  disabled: boolean;
}

/** The lists (09-ui.md#layout), in the sidebar's order, with their `␣x` commands (10-keymap.md#leader-groups). */
const LISTS: readonly (readonly [name: string, command: string, key: string])[] = [
  ["Doubts", "lists.doubts", "␣xx"],
  ["Flags", "lists.flags", "␣xf"],
  ["Office hours", "lists.officeHours", "␣xo"],
  ["Later", "lists.later", "␣xl"],
  ["Revise", "lists.revise", "␣xr"],
];

/** The rail's `courses`, then the lectures, lists and sources (slides, then readings) of `open`. */
export function switcherEntries(courses: readonly KnownCourse[], open: CourseOpened | null): SwitchEntry[] {
  const out: SwitchEntry[] = courses.map((c) => ({
    id: `course:${c.path}`,
    kind: "course",
    label: c.name,
    detail: c.missing ? `missing: ${c.path}` : c.path,
    target: c.path,
    disabled: c.missing,
  }));
  if (!open) return out;
  for (const l of open.lectures)
    out.push({
      id: `lecture:${l.path}`,
      kind: "lecture",
      label: l.name,
      detail: open.name,
      target: l.path,
      disabled: false,
    });
  for (const [name, command, key] of LISTS)
    out.push({ id: `list:${command}`, kind: "list", label: name, detail: key, target: command, disabled: false });
  for (const f of [...open.slides, ...open.sources])
    out.push({
      id: `source:${f.path}`,
      kind: "source",
      label: f.name,
      detail: f.path,
      target: f.path,
      disabled: false,
    });
  return out;
}
