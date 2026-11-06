// The Settings window's state (12-settings-theme-onboarding.md#settings): open or shut, the page,
// the search, which file a change goes to (global, or the open course's own), the settings from
// the core's schema, every value in force, and what the core said about a write. A change is
// written at once and the answer (the value then in force) shown; `settings:changed` keeps the
// values right when `:set` or a key changes one while the window is open.
import { batch, createMemo, createSignal } from "solid-js";
import type { IpcError, Setting, SettingScope, SettingState } from "../../core/bindings";
import { readSchema } from "../cmdline/schema";
import { createFilter, type Entry, entriesOf } from "./filter";
import type { PageId } from "./pages";

/** A command's answer from the core: the data, or the core's error. */
type Answer<T> = { status: "ok"; data: T } | { status: "error"; error: IpcError };

/** The course open now, as Settings needs it: only a trusted one has settings of its own. */
export interface SettingsCourse {
  path: string;
  name: string;
  trusted: boolean;
}

/** The core and the app as the window uses them; tests pass fakes. */
export interface SettingsDeps {
  schema(): Promise<Answer<string>>;
  values(course: string | null): Promise<Answer<SettingState[]>>;
  set(key: string, json: string, course: string | null, scope: SettingScope): Promise<Answer<Setting>>;
  /** The names of the themes `ui.theme` can pick (`theme_list`). */
  themes(): Promise<Answer<string[]>>;
  course(): SettingsCourse | null;
}

/** The line shown when the settings couldn't be read. */
export const UNREAD = "Lecter could not read the settings; try again.";

export type SettingsWindow = ReturnType<typeof createSettings>;

export function createSettings(deps: SettingsDeps) {
  const [isOpen, setOpen] = createSignal(false);
  const [page, setPage] = createSignal<PageId>("appearance");
  const [query, setQuery] = createSignal("");
  const [chosenScope, setScope] = createSignal<SettingScope>("global");
  const [entries, setEntries] = createSignal<readonly Entry[]>([]);
  const [values, setValues] = createSignal<Readonly<Record<string, SettingState>>>({});
  const [errors, setErrors] = createSignal<Readonly<Record<string, string>>>({});
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [themes, setThemes] = createSignal<readonly string[]>([]);
  let find = createFilter([]);
  let schemaAsk: Promise<boolean> | null = null;
  let themesAsked = false;

  /** The schema's settings, asked for once; a failed ask is asked again at the next open. */
  const loadSchema = (): Promise<boolean> => {
    schemaAsk ??= deps.schema().then((answer) => {
      const specs = answer.status === "ok" ? readSchema(answer.data) : [];
      if (specs.length === 0) {
        schemaAsk = null;
        return false;
      }
      const all = entriesOf(specs);
      find = createFilter(all);
      setEntries(all);
      return true;
    });
    return schemaAsk;
  };

  /** Every value in force for the course open now; asked at each open, so a hand edit shows. */
  const loadValues = async (): Promise<boolean> => {
    const answer = await deps.values(deps.course()?.path ?? null);
    if (answer.status !== "ok") return false;
    setValues(Object.fromEntries(answer.data.map((s) => [s.key, s])));
    return true;
  };

  const loadThemes = () => {
    if (themesAsked) return;
    themesAsked = true;
    void deps.themes().then((answer) => {
      if (answer.status === "ok") setThemes(answer.data);
      else themesAsked = false;
    });
  };

  /** Whether "This course" can be chosen: a course is open and trusted. */
  const courseScope = () => deps.course()?.trusted === true;
  /** The file a change goes to now. */
  const scope = (): SettingScope => (chosenScope() === "course" && courseScope() ? "course" : "global");

  /** The settings shown: the search's matches over every page, or the page's own. */
  const shown = createMemo<readonly Entry[]>(() => {
    const all = entries();
    const q = query();
    if (q.trim() !== "") return find(q);
    const p = page();
    return all.filter((e) => e.page === p);
  });

  /** A setting as the core now has it in force. */
  const changed = (setting: Setting) => {
    const held = values()[setting.key];
    if (!held) return;
    setValues({ ...values(), [setting.key]: { ...held, value: setting.value, source: setting.source } });
  };

  const setError = (key: string, message: string | null) => {
    const { [key]: _, ...rest } = errors();
    setErrors(message === null ? rest : { ...rest, [key]: message });
  };

  return {
    isOpen,
    page,
    query,
    entries,
    shown,
    values,
    errors,
    loadError,
    themes,
    scope,
    courseScope,
    /** Opens the window (on `to`, when given) and reads the schema and the values in force. */
    open: async (to?: PageId) => {
      batch(() => {
        setOpen(true);
        if (to) setPage(to);
        setLoadError(null);
      });
      loadThemes();
      const [schemaOk, valuesOk] = await Promise.all([loadSchema(), loadValues()]);
      if (!(schemaOk && valuesOk)) setLoadError(UNREAD);
    },
    close: () => {
      batch(() => {
        setOpen(false);
        setQuery("");
        setErrors({});
      });
    },
    showPage: (to: PageId) => {
      batch(() => {
        setPage(to);
        setQuery("");
      });
    },
    setQuery,
    setScope,
    changed,
    setError,
    /**
     * Writes `key` = `json` to the file of the scope chosen now, and shows the value then in force,
     * or the core's reason for refusing it under the setting.
     */
    write: async (key: string, json: string): Promise<boolean> => {
      setError(key, null);
      const answer = await deps.set(key, json, deps.course()?.path ?? null, scope());
      if (answer.status === "ok") {
        changed(answer.data);
        return true;
      }
      setError(key, answer.error.message);
      return false;
    },
  };
}
