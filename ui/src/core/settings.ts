import { commands, events, type IpcError, type Setting, type SettingScope, type SettingState } from "./bindings";

export type { Setting, SettingScope, SettingState };

/** A settings command's answer: the data, or the core's error. */
export type SettingsResult<T> = { status: "ok"; data: T } | { status: "error"; error: IpcError };

/** The settings schema as JSON text (`settings_schema`): keys, types and allowed values. */
export function readSettingsSchema(): Promise<SettingsResult<string>> {
  return commands.settingsSchema();
}

/** The value of `key` in force and its level (`settings_get`); `course` adds a trusted course's own. */
export function getSetting(key: string, course: string | null): Promise<SettingsResult<Setting>> {
  return commands.settingsGet(key, course);
}

/** Every setting in force, its level and whether only the global settings may set it (`settings_source`). */
export function readSettingsInForce(course: string | null): Promise<SettingsResult<SettingState[]>> {
  return commands.settingsSource(course);
}

/**
 * Writes `key` (value as JSON text) to the global settings, or with `scope` "course" to the
 * trusted `course`'s own, and returns the value then in force; `settings:changed` follows.
 */
export function setSetting(
  key: string,
  value: string,
  course: string | null,
  scope: SettingScope = "global",
): Promise<SettingsResult<Setting>> {
  return commands.settingsSet(key, value, course, scope);
}

/**
 * Calls `listener` with each setting a write changed (`settings:changed`), as then in force.
 * Resolves to the function that stops listening.
 */
export async function onSettingsChanged(listener: (setting: Setting) => void): Promise<() => void> {
  const unlisten = await events.settingsChanged.listen((event) => listener(event.payload.setting));
  return () => {
    Promise.resolve(unlisten()).catch(() => {});
  };
}
