// The command palette and the quick switcher, as state (09-ui.md#slack-and-discord-behaviours):
// one box, two lists. Ctrl/Cmd-Shift-P opens it on every command with its keys, Ctrl/Cmd-p on the
// courses, lectures, lists and sources. Typing filters by fuzzy match; ↑/↓ move the pick, Enter
// (or a click) takes it; Esc closes and gives the focus back to where it was.
import { type Accessor, createMemo, createSignal } from "solid-js";
import type { CommandEntry, SwitchEntry } from "./entries";
import { fuzzyFilter } from "./fuzzy";

export type PaletteMode = "commands" | "switch";

/** At most this many rows show; typing narrows the rest. */
export const SHOWN_MAX = 200;

/** One row of the list, either kind. */
export interface Row {
  id: string;
  label: string;
  /** The label's indices the query matched, to mark. */
  hits: number[];
  /** A command's keycaps; a place has none. */
  keys: string[];
  /** A place's kind (Course, Lecture, List, Source); a command's is empty. */
  kind: string;
  /** Where a command works, or what a place is. */
  detail: string;
  /** A command that can't run where the focus was, or a course that is missing. */
  disabled: boolean;
}

export interface PaletteOptions {
  /** Every command, read each time the palette opens (keymaps.jsonc can change the keys). */
  commands: () => CommandEntry[];
  /** Whether a command can run where the focus was when the palette opened. */
  canRun: (entry: CommandEntry) => boolean;
  /** The places the switcher jumps to, as they are now. */
  places: Accessor<SwitchEntry[]>;
  /** Gives the focus back to where it was before the palette opened. */
  restore: () => void;
  onCommand: (entry: CommandEntry) => void;
  onPlace: (entry: SwitchEntry) => void;
}

export interface Palette {
  /** Which list is open, or `null` when closed. */
  mode: Accessor<PaletteMode | null>;
  query: Accessor<string>;
  setQuery: (text: string) => void;
  rows: Accessor<Row[]>;
  /** How many more rows match than show. */
  more: Accessor<number>;
  picked: Accessor<number>;
  /** Moves the pick by `delta`, round the ends. */
  move: (delta: number) => void;
  /** Takes the row at `index` (the picked one by default): closes and runs or jumps. */
  pick: (index?: number) => void;
  /** Opens the list for `mode` with an empty query; switches to it when the other is open. */
  open: (mode: PaletteMode) => void;
  /** Closes; gives the focus back unless `restore` is false (a click went elsewhere). */
  close: (restore?: boolean) => void;
}

const KIND: Readonly<Record<SwitchEntry["kind"], string>> = {
  course: "Course",
  lecture: "Lecture",
  list: "List",
  source: "Source",
};

export function createPalette(opts: PaletteOptions): Palette {
  const [mode, setMode] = createSignal<PaletteMode | null>(null);
  const [query, setQueryText] = createSignal("");
  const [picked, setPicked] = createSignal(0);
  // The commands and what can run, as they were when the palette opened.
  const [commands, setCommands] = createSignal<{ entry: CommandEntry; runs: boolean }[]>([]);

  type Item = { row: Omit<Row, "hits">; take: () => void };
  const items = createMemo<Item[]>(() => {
    const m = mode();
    if (m === "commands")
      return commands().map(({ entry, runs }) => ({
        row: { id: entry.id, label: entry.title, keys: entry.keys, kind: "", detail: entry.where, disabled: !runs },
        take: () => opts.onCommand(entry),
      }));
    if (m === "switch")
      return opts.places().map((entry) => ({
        row: {
          id: entry.id,
          label: entry.label,
          keys: [],
          kind: KIND[entry.kind],
          detail: entry.detail,
          disabled: entry.disabled,
        },
        take: () => opts.onPlace(entry),
      }));
    return [];
  });
  const matches = createMemo(() => fuzzyFilter(items(), query(), (item) => item.row.label));
  const shown = createMemo(() => matches().slice(0, SHOWN_MAX));
  const rows = createMemo<Row[]>(() => shown().map((m) => ({ ...m.item.row, hits: m.hits })));

  const setQuery = (text: string) => {
    setQueryText(text);
    setPicked(0);
  };

  const close = (restore = true) => {
    if (mode() === null) return;
    setMode(null);
    setQuery("");
    if (restore) opts.restore();
  };

  return {
    mode,
    query,
    setQuery,
    rows,
    more: () => matches().length - shown().length,
    picked,
    move: (delta) => {
      const n = rows().length;
      if (n === 0) return;
      setPicked((((picked() + delta) % n) + n) % n);
    },
    pick: (index = picked()) => {
      const item = shown()[index]?.item;
      if (!item || item.row.disabled) return;
      close();
      item.take();
    },
    open: (next) => {
      if (next === "commands") setCommands(opts.commands().map((entry) => ({ entry, runs: opts.canRun(entry) })));
      setQuery("");
      setMode(next);
    },
    close,
  };
}
