import { commands, type IpcError } from "./bindings";

/** What reading keymaps.jsonc came to: its text (null: no file), or the core's error. */
export type KeymapsResult = { status: "ok"; data: string | null } | { status: "error"; error: IpcError };

/**
 * The text of the user's keymaps.jsonc in the global config folder (`keymaps_read`, D-199). The
 * key engine asks once it is in, and keeps the default keys until the answer comes.
 */
export function readKeymaps(): Promise<KeymapsResult> {
  return commands.keymapsRead();
}
