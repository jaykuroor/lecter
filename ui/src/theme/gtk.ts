// The desktop's GTK theme on Linux, or the theme `ui.theme` chose (F-043,
// 12-settings-theme-onboarding.md#theme). The core sends the tokens to set; this applies them as
// one batch of CSS custom properties on the root element (D-240): inline values beat the Lecter
// theme's in tokens.css, light and dark alike, and every token not sent keeps Lecter's. No
// component re-renders: styles read the properties through var().

import { getTheme, onThemeChanged, type ThemeUpdate } from "../core/theme";

// The core formats every value from numbers; anything else is refused here too.
const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const VALUE = /^(?:#[0-9a-f]{6}|rgba\((?:\d{1,3}, ){3}(?:0|1|0?\.\d{1,3})\))$/;

/** What the last update set on a root, so the next one clears what it no longer sets. */
const applied = new WeakMap<HTMLElement, { names: string[]; scheme: boolean }>();

/**
 * Sets the update's tokens as `--<name>` on `root` and clears those the previous update set but
 * this one doesn't; sets `data-theme` to its scheme, or removes the one it set before.
 */
export function applyTheme(update: ThemeUpdate, root: HTMLElement = document.documentElement): void {
  const before = applied.get(root);
  const style = root.style;
  const valid = update.tokens.filter(({ name, value }) => NAME.test(name) && VALUE.test(value));
  for (const { name, value } of valid) style.setProperty(`--${name}`, value);
  const names = valid.map(({ name }) => name);
  if (before) {
    for (const name of before.names) {
      if (!names.includes(name)) style.removeProperty(`--${name}`);
    }
  }
  if (update.scheme) root.dataset.theme = update.scheme;
  else if (before?.scheme) delete root.dataset.theme;
  applied.set(root, { names, scheme: update.scheme !== null });
}

/**
 * Applies the current theme and each change after it. An answer to the first read that arrives
 * after a change was applied is dropped: the change is newer. Resolves to the function that stops.
 */
export async function followTheme(root: HTMLElement = document.documentElement): Promise<() => void> {
  let changed = false;
  const stop = await onThemeChanged((update) => {
    changed = true;
    applyTheme(update, root);
  });
  const current = await getTheme();
  if (current.status === "ok" && !changed) applyTheme(current.data, root);
  return stop;
}
