import { commands, events, type IpcError, type ThemeUpdate } from "./bindings";

export type { ThemeUpdate };

/** A theme command's answer: the data, or the core's error. */
export type ThemeResult<T> = { status: "ok"; data: T } | { status: "error"; error: IpcError };

/**
 * The tokens to set now (`theme_get`): the desktop's GTK theme on Linux, or the one `ui.theme`
 * chose, with light or dark; nothing set means the Lecter theme. (`theme_list`, the installed
 * GTK themes, is for Settings → Appearance, F-045.)
 */
export function getTheme(): Promise<ThemeResult<ThemeUpdate>> {
  return commands.themeGet();
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
