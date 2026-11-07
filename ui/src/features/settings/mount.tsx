// The Settings window at work in the page: a chunk of its own, loaded the first time it opens
// (register.ts), so neither the first paint nor the key path carries it. It remembers where the
// focus was when it opened and gives it back when it closes, reads the values in force at every
// open, and follows `settings:changed` while the page lives, so a `:set` or a key that changes a
// setting shows here too.
import { Show } from "solid-js";
import { render } from "solid-js/web";
import type { CourseOpened } from "../../core/course";
import { onSettingsChanged, readSettingsInForce, readSettingsSchema, setSetting } from "../../core/settings";
import { listThemes } from "../../core/theme";
import type { Binding } from "../../keys/keymap";
import type { PageId } from "./pages";
import { SettingsWindow } from "./SettingsWindow";
import { createSettings, type SettingsWindow as Settings, type SettingsCourse } from "./state";

/** What the window needs from the app. */
export interface SettingsContext {
  /** Where the window shows. */
  host: HTMLElement;
  mac: boolean;
  /** The key engine's bindings now (keymaps.jsonc laid over the defaults), for the Keys page. */
  bindings: () => readonly Binding[];
  course: () => CourseOpened | null;
}

export interface SettingsHandle {
  settings: Settings;
  /** Opens the window (on page `to`), or puts the focus in its search when it is open. */
  open: (to?: PageId) => void;
  stop: () => void;
}

/** The open course as Settings needs it. */
const courseOf = (c: CourseOpened | null): SettingsCourse | null =>
  c ? { path: c.path, name: c.name, trusted: c.trust === "trusted" } : null;

export function startSettings(ctx: SettingsContext): SettingsHandle {
  /** Where the focus was when the window opened. */
  let before: HTMLElement = document.body;
  let stopped = false;
  let unlisten: (() => void) | undefined;
  const course = () => courseOf(ctx.course());

  let settings!: Settings;
  const close = () => {
    settings.close();
    // Focusing an element that has gone does nothing.
    before.focus();
  };
  const dispose = render(() => {
    settings = createSettings({
      schema: readSettingsSchema,
      values: readSettingsInForce,
      set: setSetting,
      themes: listThemes,
      course,
    });
    return (
      <Show when={settings.isOpen()}>
        <SettingsWindow settings={settings} course={course} bindings={ctx.bindings} mac={ctx.mac} onClose={close} />
      </Show>
    );
  }, ctx.host);

  void onSettingsChanged((s) => settings.changed(s)).then(
    (stop) => {
      if (stopped) stop();
      else unlisten = stop;
    },
    () => {},
  );

  const focusSearch = () => (ctx.host.querySelector(".settings-search") as HTMLInputElement).focus();

  return {
    settings,
    open: (to) => {
      if (!settings.isOpen()) {
        before = document.activeElement as HTMLElement;
        void settings.open(to);
      }
      focusSearch();
    },
    stop: () => {
      stopped = true;
      unlisten?.();
      dispose();
    },
  };
}
