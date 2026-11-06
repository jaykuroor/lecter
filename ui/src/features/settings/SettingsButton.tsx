import { createSignal, type JSX, onCleanup } from "solid-js";
import { hasCommand, runCommand, watchCommands } from "../../keys/commands";
import { SETTINGS_COMMAND } from "./register";

/**
 * The headerbar's mouse way to Settings (docs/design/components.md#headerbar, right controls),
 * with its key as a keycap. A click runs the same command as Ctrl/Cmd-, (register.ts); until the
 * key engine is in and Settings registered, it is disabled. It ships in the first-paint chunk, so
 * it borrows the switcher's button styles (palette/PaletteButtons.css) instead of adding its own.
 */
export function SettingsButton(props: { mac: boolean }): JSX.Element {
  const [ready, setReady] = createSignal(hasCommand(SETTINGS_COMMAND));
  onCleanup(watchCommands(() => setReady(hasCommand(SETTINGS_COMMAND))));
  return (
    <button
      type="button"
      class="palette-button"
      aria-label="Settings"
      aria-keyshortcuts={props.mac ? "Meta+Comma" : "Control+Comma"}
      title="Settings"
      disabled={!ready()}
      onClick={() =>
        runCommand({
          binding: { keys: "<Mod-,>", command: SETTINGS_COMMAND, scope: "global", desc: "Settings" },
          count: 1,
          explicit: false,
        })
      }
    >
      <svg class="palette-button-icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" />
        <path
          d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"
          stroke="currentColor"
        />
      </svg>
      <kbd class="sidebar-key">{props.mac ? "⌘," : "Ctrl-,"}</kbd>
    </button>
  );
}
