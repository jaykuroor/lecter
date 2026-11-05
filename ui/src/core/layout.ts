import { commands, type IpcError, type Layout } from "./bindings";

export type { Layout };

/** What reading or saving the layout came to: the value, or the core's error. */
export type LayoutResult<T> = { status: "ok"; data: T } | { status: "error"; error: IpcError };

/**
 * The window's layout as the last run left it (`app_layout_get`, D-195), from `<data>/state.db`;
 * the first start's (the sidebar shows) when none was saved.
 */
export function getLayout(): Promise<LayoutResult<Layout>> {
  return commands.appLayoutGet();
}

/** Saves the layout, which the next start opens with (`app_layout_save`). */
export function saveLayout(layout: Layout): Promise<LayoutResult<null>> {
  return commands.appLayoutSave(layout);
}
