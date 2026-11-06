import { createSignal, type JSX, onCleanup } from "solid-js";
import { hasCommand, runCommand, watchCommands } from "../../keys/commands";
import { PALETTE_COMMANDS } from "./register";
import "./PaletteButtons.css";

/**
 * The headerbar's mouse way to the quick switcher and the command palette
 * (docs/design/components.md#headerbar, right controls), each with its key as a keycap. A click
 * runs the same command as the key (register.ts), so the two never differ; until the key engine
 * is in and the palette registered, the buttons are disabled. The keycaps show the default keys
 * (10-keymap.md#global-os-conventions); the hint bar shows keymaps.jsonc's.
 */
export function PaletteButtons(props: { mac: boolean }): JSX.Element {
  const [ready, setReady] = createSignal(hasCommand(PALETTE_COMMANDS.switch));
  onCleanup(watchCommands(() => setReady(hasCommand(PALETTE_COMMANDS.switch))));
  const run = (command: string, keys: string, desc: string) => {
    runCommand({ binding: { keys, command, scope: "global", desc }, count: 1, explicit: false });
  };
  return (
    <>
      <button
        type="button"
        class="palette-button"
        aria-label="Go to"
        aria-keyshortcuts={props.mac ? "Meta+P" : "Control+P"}
        title="Go to a course, lecture, list or source"
        disabled={!ready()}
        onClick={() => run(PALETTE_COMMANDS.switch, "<Mod-p>", "Quick switcher")}
      >
        <svg class="palette-button-icon" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" />
          <path d="M10.3 10.3l3.7 3.7" stroke="currentColor" />
        </svg>
        <kbd class="sidebar-key">{props.mac ? "⌘p" : "Ctrl-p"}</kbd>
      </button>
      <button
        type="button"
        class="palette-button"
        aria-label="Commands"
        aria-keyshortcuts={props.mac ? "Meta+Shift+P" : "Control+Shift+P"}
        title="Every command, with its keys"
        disabled={!ready()}
        onClick={() => run(PALETTE_COMMANDS.commands, "<Mod-S-p>", "Command palette")}
      >
        <svg class="palette-button-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 4.5h10M3 8h10M3 11.5h10" stroke="currentColor" />
        </svg>
        <kbd class="sidebar-key">{props.mac ? "⇧⌘p" : "Ctrl-Shift-p"}</kbd>
      </button>
    </>
  );
}
