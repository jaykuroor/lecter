// `:set key=value` and `:set key?` (10-keymap.md#commands, 12-settings-theme-onboarding.md#settings):
// what the words after `:set` ask for, checked against the schema before anything reaches the core,
// and how a setting is shown back: its value and the level it comes from.
import type { Setting } from "../../core/bindings";
import { checkValue, type SettingSpec, showValue } from "./schema";

/** What a `:set` line asks for: show a key, write a key, or a refusal to show. */
export type SetPlan =
  | { op: "show"; key: string }
  | { op: "write"; key: string; json: string }
  | { op: "refuse"; reason: string };

/** The line for a `:set` that is neither form. */
export const SET_USAGE = "Use :set key=value or :set key?";

/**
 * Notes `:set` shows with a value, by key and value (JSON text). Quality highlights and typesets on
 * every keystroke (12-settings-theme-onboarding.md#performance-preset).
 */
const NOTES: Record<string, Record<string, string>> = {
  "ui.performance": { '"quality"': "Can add input lag on slower machines." },
};

/** The note that goes with `key` at `json`, if any. */
export const noteFor = (key: string, json: string): string | null => NOTES[key]?.[json] ?? null;

/** What `args` (the text after `:set `) asks for, with the value checked against `specs`. */
export function planSet(args: string, specs: readonly SettingSpec[]): SetPlan {
  const text = args.trim();
  const eq = text.indexOf("=");
  const asks = eq < 0;
  if (asks && !text.endsWith("?")) return { op: "refuse", reason: SET_USAGE };
  const key = (asks ? text.slice(0, -1) : text.slice(0, eq)).trim();
  if (key === "" || /\s/.test(key)) return { op: "refuse", reason: SET_USAGE };
  const spec = specs.find((s) => s.key === key);
  if (!spec) return { op: "refuse", reason: `${key} is not a setting` };
  if (asks) return { op: "show", key };
  const checked = checkValue(spec, text.slice(eq + 1));
  return checked.ok ? { op: "write", key, json: checked.json } : { op: "refuse", reason: checked.reason };
}

/** A setting as `:set` reports it: `ui.performance=balanced (default)`, and its note. */
export function describeSetting(setting: Setting): { line: string; note: string | null } {
  return {
    line: `${setting.key}=${showValue(setting.value)} (${setting.source})`,
    note: noteFor(setting.key, setting.value),
  };
}
