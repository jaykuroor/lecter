// The hint bar's detail, the setting `ui.hintBar` (12-settings-theme-onboarding.md#settings):
// `full` shows each key with its words and its mouse action, `compact` the keys and their words,
// `off` hides the bar. ␣uh steps through them (10-keymap.md#leader-groups).

export type HintDetail = "full" | "compact" | "off";

export const HINT_DETAILS: readonly HintDetail[] = ["full", "compact", "off"];

/** The detail before anything sets `ui.hintBar` (onboarding's Vim step, Settings, `:set`). */
export const DEFAULT_HINT_DETAIL: HintDetail = "full";

/** The detail after `detail` (␣uh): full → compact → off → full. */
export function nextDetail(detail: HintDetail): HintDetail {
  return HINT_DETAILS[(HINT_DETAILS.indexOf(detail) + 1) % HINT_DETAILS.length] as HintDetail;
}
