// The Settings window rendered over a fake core, open, for the window's and the rows' tests.
import { render, screen, waitFor } from "@solidjs/testing-library";
import { createRoot } from "solid-js";
import { expect } from "vitest";
import type { SettingSource } from "../../../core/bindings";
import { DEFAULT_KEYMAP } from "../../../keys/keymap";
import { SettingsWindow } from "../SettingsWindow";
import { createSettings, type SettingsWindow as SettingsWindowState } from "../state";
import { type FakeSettingsCore, fakeSettingsCore } from "./fakeCore";

export interface Opened {
  core: FakeSettingsCore;
  settings: SettingsWindowState;
  closed: () => number;
  dialog: HTMLElement;
}

/** The values of a new install: each setting's built-in default (crates/core settings.schema.json). */
export const DEFAULTS: Record<string, { value: string; source: SettingSource }> = {
  "ui.performance": { value: '"balanced"', source: "default" },
  "ui.hintBar": { value: '"full"', source: "default" },
  "ui.keystrokes": { value: "true", source: "default" },
  "ui.theme": { value: "null", source: "default" },
  "ai.hedgeAfterMs": { value: "1500", source: "default" },
};

/** Renders the window over `core` (a new install's values by default) and opens it. */
export async function opened(core: FakeSettingsCore = fakeSettingsCore(DEFAULTS)): Promise<Opened> {
  const settings = createRoot(() => createSettings(core));
  let closes = 0;
  render(() => (
    <SettingsWindow
      settings={settings}
      course={core.course}
      bindings={() => DEFAULT_KEYMAP}
      mac={false}
      onClose={() => {
        closes += 1;
      }}
    />
  ));
  await settings.open();
  await waitFor(() => expect(document.querySelector(".settings-row")).not.toBeNull());
  return { core, settings, closed: () => closes, dialog: screen.getByRole("dialog", { name: "Settings" }) };
}

/** A keydown on `target`, as dispatched (its `defaultPrevented` says whether the window took it). */
export function key(target: Element, k: string, extra: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra });
  target.dispatchEvent(e);
  return e;
}

/** The row of the setting `key`. */
export const row = (k: string): HTMLElement => document.querySelector(`[data-key="${k}"]`) as HTMLElement;
