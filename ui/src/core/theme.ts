import { commands, events, type InstalledTheme, type IpcError, type ThemeUpdate } from "./bindings";

export type { InstalledTheme, ThemeUpdate };

/** A theme command's answer: the data, or the core's error. */
export type ThemeResult<T> = { status: "ok"; data: T } | { status: "error"; error: IpcError };

/**
 * The tokens to set now (`theme_get`): the desktop's GTK theme on Linux, or the one `ui.theme`
 * chose, with light or dark; nothing set means the Lecter theme.
 */
export function getTheme(): Promise<ThemeResult<ThemeUpdate>> {
  return commands.themeGet();
}

/** The installed GTK themes (`theme_list`); `setSetting("ui.theme", …)` applies one. */
export function listThemes(): Promise<ThemeResult<InstalledTheme[]>> {
  return commands.themeList();
}

/**
 * Calls `listener` with each new update (`theme:changed`: the desktop's theme, scheme or accent
 * changed, or `ui.theme` did). Resolves to the function that stops listening.
 */
export async function onThemeChanged(listener: (update: ThemeUpdate) => void): Promise<() => void> {
  const unlisten = await events.themeChanged.listen((event) => listener(event.payload.update));
  return () => {
    Promise.resolve(unlisten()).catch(() => {});
  };
}
