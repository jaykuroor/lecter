// What the command line offers as you type (10-keymap.md#commands): the commands that exist so far
// for the first word; after `set `, the setting keys; after `set key=`, the values a fixed-choice or
// true/false key takes. Matching is by prefix, in the list's order.
import type { SettingSpec } from "./schema";

/** One command the command line knows: its name and what it does (10-keymap.md#commands). */
export interface CommandInfo {
  name: string;
  desc: string;
  /** Whether words follow the name (completion then adds a space). */
  args: boolean;
}

/**
 * The `:` commands Lecter has so far. `set` runs here; the others are Vim Ex commands their
 * features define (`:find` in features/find, `:read` in features/overlay), which the command line
 * hands to Vim as typed. A feature that adds a command adds its line here.
 */
export const COMMANDS: readonly CommandInfo[] = [
  { name: "find", desc: "Search sources, cite page", args: true },
  { name: "read", desc: "Read mode", args: false },
  { name: "set", desc: "Any setting", args: true },
];

/** One completion: what it shows, and the whole command line once it is taken. */
export interface Completion {
  label: string;
  detail: string;
  line: string;
}

/** The most completions shown at once. */
export const MAX_COMPLETIONS = 50;

const SET_ARGS = /^(\s*set\s+)(\S*)$/;
const SET_VALUE = /^(\s*set\s+)([^\s=]+)=(\S*)$/;

/**
 * The completions for the command line `line`, given the settings (empty until the schema is in).
 * One that would leave the line as it is (it is typed out already) is left out.
 */
export function complete(line: string, settings: readonly SettingSpec[]): Completion[] {
  return candidates(line, settings).filter((c) => c.line !== line);
}

/** Every completion that matches `line`. */
function candidates(line: string, settings: readonly SettingSpec[]): Completion[] {
  const value = SET_VALUE.exec(line);
  if (value) {
    const [, lead, key, typed] = value as unknown as [string, string, string, string];
    const spec = settings.find((s) => s.key === key);
    const values = !spec ? [] : spec.kind === "boolean" ? ["true", "false"] : spec.choices;
    return values
      .filter((v) => v.startsWith(typed))
      .map((v) => ({ label: v, detail: key, line: `${lead}${key}=${v}` }));
  }
  const args = SET_ARGS.exec(line);
  if (args) {
    const [, lead, typed] = args as unknown as [string, string, string];
    return settings
      .filter((s) => s.key.startsWith(typed))
      .slice(0, MAX_COMPLETIONS)
      .map((s) => ({ label: s.key, detail: s.description, line: `${lead}${s.key}` }));
  }
  const word = /^\s*(\w*)$/.exec(line);
  if (!word) return [];
  const typed = word[1] as string;
  return COMMANDS.filter((c) => c.name.startsWith(typed)).map((c) => ({
    label: c.name,
    detail: c.desc,
    line: c.args ? `${c.name} ` : c.name,
  }));
}

/** The command a line runs here (`set` and its arguments), or null: Vim's Ex table runs it. */
export function ownCommand(line: string): { name: "set"; args: string } | null {
  const m = /^\s*set(?:\s+(.*))?$/s.exec(line);
  return m ? { name: "set", args: m[1] ?? "" } : null;
}
