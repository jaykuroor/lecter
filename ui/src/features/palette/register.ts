// Ctrl/Cmd-Shift-P and Ctrl/Cmd-p (10-keymap.md#global-os-conventions) and the headerbar's buttons
// open the palette through the key engine's command registry (keys/commands.ts), so a key and a
// click do the same. The palette's own code is a chunk that starts loading here, once the engine is
// in; a key pressed before it has loaded opens the palette as soon as it has.
import { registerCommand } from "../../keys/commands";
import type { PaletteContext, PaletteHandle } from "./mount";
import type { PaletteMode } from "./state";

/** The commands the palette's keys run (keys/keymap.ts). */
export const PALETTE_COMMANDS: Readonly<Record<PaletteMode, string>> = {
  commands: "palette.open",
  switch: "switcher.open",
};

/**
 * Handles `palette.open` and `switcher.open` from now on and loads the palette's chunk. Returns
 * the function that drops the handlers and the palette.
 */
export function registerPalette(
  ctx: PaletteContext,
  load: () => Promise<typeof import("./mount")> = () => import("./mount"),
): () => void {
  let gone = false;
  const started: Promise<PaletteHandle | null> = load().then((m) => (gone ? null : m.startPalette(ctx)));
  const open = (mode: PaletteMode) => {
    void started.then((p) => {
      if (p && !gone) p.open(mode);
    });
  };
  const drops = [
    registerCommand(PALETTE_COMMANDS.commands, () => {
      open("commands");
    }),
    registerCommand(PALETTE_COMMANDS.switch, () => {
      open("switch");
    }),
  ];
  return () => {
    gone = true;
    for (const drop of drops) drop();
    void started.then((p) => p?.stop());
  };
}
