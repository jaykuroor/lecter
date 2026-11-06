// Ctrl/Cmd-, (10-keymap.md#global-os-conventions) and the headerbar's button open Settings through
// the key engine's command registry (keys/commands.ts), so a key and a click do the same. The
// window's code is a chunk that loads the first time it opens (D-237: nothing loaded until used);
// the handler only starts that, so the key path never waits for it.
import { registerCommand } from "../../keys/commands";
import type { SettingsContext, SettingsHandle } from "./mount";

/** The command Ctrl/Cmd-, runs (keys/keymap.ts). */
export const SETTINGS_COMMAND = "settings.open";

/**
 * Handles `settings.open` from now on; the window's chunk loads on the first open. Returns the
 * function that drops the handler and the window.
 */
export function registerSettings(
  ctx: SettingsContext,
  load: () => Promise<typeof import("./mount")> = () => import("./mount"),
): () => void {
  let gone = false;
  let started: Promise<SettingsHandle | null> | null = null;
  const drop = registerCommand(SETTINGS_COMMAND, () => {
    started ??= load().then((m) => (gone ? null : m.startSettings(ctx)));
    void started.then((s) => {
      if (s && !gone) s.open();
    });
  });
  return () => {
    gone = true;
    drop();
    void started?.then((s) => s?.stop());
  };
}
