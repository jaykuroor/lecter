import { commands, type IpcError, type Setting } from "./bindings";

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

/** Writes `key` (value as JSON text) to the global settings and returns the value then in force. */
export function setSetting(key: string, value: string, course: string | null): Promise<SettingsResult<Setting>> {
  return commands.settingsSet(key, value, course);
}
