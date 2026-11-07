// Settings → Performance (12-settings-theme-onboarding.md#performance-preset, D-081, D-143): the
// three presets of `ui.performance` as a group of choices, each saying what it does. Balanced is
// the default, so a new install shows it picked. With Quality picked, the window shows the note
// `:set` shows too: "Can add input lag on slower machines."
import { For, type JSX, Show } from "solid-js";
import { noteFor } from "../cmdline/set";

/** The presets in order, with what each does (from the spec's words). */
const PRESETS: readonly { value: string; title: string; detail: string }[] = [
  {
    value: "performance",
    title: "Performance",
    detail: "No Markdown highlighting and no live math in notes and glosses; math shows as its source text.",
  },
  {
    value: "balanced",
    title: "Balanced",
    detail: "Highlighting runs after typing pauses for 200 ms; math loads when it first comes into view.",
  },
  {
    value: "quality",
    title: "Quality",
    detail: "Highlighting and math update on every keystroke.",
  },
];

export function PerformancePreset(props: {
  /** The value in force as JSON text: `"performance"`, `"balanced"` or `"quality"`. */
  json: string;
  /** The radio group's name, and its id. */
  name: string;
  labelledBy: string;
  disabled: boolean;
  /** Called with the picked preset as JSON text. */
  onPick: (json: string) => void;
}): JSX.Element {
  const note = () => noteFor("ui.performance", props.json);
  return (
    <div class="settings-preset">
      <div id={props.name} class="settings-preset-choices" role="radiogroup" aria-labelledby={props.labelledBy}>
        <For each={PRESETS}>
          {(p) => (
            <label class="settings-preset-choice">
              <input
                type="radio"
                name={props.name}
                value={p.value}
                checked={props.json === JSON.stringify(p.value)}
                disabled={props.disabled}
                onChange={() => props.onPick(JSON.stringify(p.value))}
              />
              <span class="settings-preset-title">{p.title}</span>
              <span class="settings-preset-detail">{p.detail}</span>
            </label>
          )}
        </For>
      </div>
      <Show when={note()}>
        {(text) => (
          <p class="settings-note settings-lag-note" role="note">
            {text()}
          </p>
        )}
      </Show>
    </div>
  );
}
