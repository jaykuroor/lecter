// One setting in the Settings window: its label, description and dotted key (what `:set` takes),
// where its value comes from, and a control for its kind: a switch for on/off, choices for a fixed
// set (a list for more than four), a field for numbers, text and lists, committed on Enter or when
// the focus leaves. `ui.performance` and `ui.theme` have controls of their own. A value is checked
// against the schema before it is written; the core's refusal shows under the setting.
import { For, type JSX, Match, Show, Switch } from "solid-js";
import type { SettingState } from "../../core/bindings";
import { checkValue, showValue } from "../cmdline/schema";
import type { Entry } from "./filter";
import { PerformancePreset } from "./PerformancePreset";
import { choiceLabel } from "./pages";
import type { SettingsWindow } from "./state";

/** Choices up to this many show as buttons; more as a list. */
const MAX_BUTTONS = 4;

/** One value a choice control offers: as the core takes it (JSON text), and in words. */
interface Choice {
  json: string;
  label: string;
}

/** The themes to list: the installed ones, and the one set now even when it isn't installed. */
function themeNames(installed: readonly string[], json: string): string[] {
  const current = installed.find((name) => JSON.stringify(name) === json);
  return current || json === "null" ? [...installed] : [...installed, JSON.parse(json) as string];
}

export function SettingRow(props: { entry: Entry; state: SettingState; settings: SettingsWindow }): JSX.Element {
  const key = () => props.entry.spec.key;
  const json = () => props.state.value;
  const id = () => `setting-${key()}`;
  const labelId = () => `${id()}-label`;
  /** A course can't set it (SEC-25) and the window writes to the course. */
  const locked = () => props.settings.scope() === "course" && props.state.globalOnly;
  const error = () => props.settings.errors()[key()];
  const write = (value: string) => void props.settings.write(key(), value);
  /** Checks typed text against the schema; a refusal shows under the setting without a write. */
  const commit = (text: string) => {
    if (text === fieldText()) return;
    const checked = checkValue(props.entry.spec, text);
    if (checked.ok) write(checked.json);
    else props.settings.setError(key(), checked.reason);
  };
  const fieldText = () => (json() === "null" ? "" : showValue(json()));
  const choices = (): Choice[] => [
    ...props.entry.spec.choices.map((c) => ({ json: JSON.stringify(c), label: choiceLabel(c) })),
    ...(props.entry.spec.nullable ? [{ json: "null", label: "Not set" }] : []),
  ];
  const placeholder = () => {
    if (props.entry.spec.kind === "list") return "a, b, c";
    return props.entry.spec.nullable ? "Not set" : "";
  };

  const field = () => (
    <input
      id={id()}
      class="settings-field"
      type="text"
      value={fieldText()}
      disabled={locked()}
      aria-labelledby={labelId()}
      aria-invalid={error() ? "true" : undefined}
      placeholder={placeholder()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit(e.currentTarget.value);
        }
      }}
      onChange={(e) => commit(e.currentTarget.value)}
    />
  );

  return (
    <div class={key() === "ui.performance" ? "settings-row settings-row-wide" : "settings-row"} data-key={key()}>
      <div class="settings-row-text">
        <span class="settings-label" id={labelId()}>
          {props.entry.label}
        </span>
        <Show when={props.entry.spec.description}>
          <span class="settings-desc">{props.entry.spec.description}</span>
        </Show>
        <span class="settings-meta">
          <code class="settings-key">{key()}</code>
          <span class="settings-source">{props.state.source === "course" ? "this course" : props.state.source}</span>
        </span>
      </div>
      <div class="settings-control">
        <Switch fallback={field()}>
          <Match when={key() === "ui.performance"}>
            <PerformancePreset json={json()} name={id()} labelledBy={labelId()} disabled={locked()} onPick={write} />
          </Match>
          <Match when={key() === "ui.theme"}>
            <select
              id={id()}
              class="settings-select"
              disabled={locked()}
              aria-labelledby={labelId()}
              onChange={(e) => write(e.currentTarget.value === "" ? "null" : JSON.stringify(e.currentTarget.value))}
            >
              <option value="">Follow the desktop</option>
              <For each={themeNames(props.settings.themes(), json())}>
                {(name) => (
                  <option value={name} selected={JSON.stringify(name) === json()}>
                    {name}
                  </option>
                )}
              </For>
            </select>
          </Match>
          <Match when={props.entry.spec.kind === "boolean"}>
            <input
              id={id()}
              class="settings-switch"
              type="checkbox"
              checked={json() === "true"}
              disabled={locked()}
              aria-labelledby={labelId()}
              onChange={(e) => write(String(e.currentTarget.checked))}
            />
          </Match>
          <Match when={choices().length > MAX_BUTTONS}>
            <select
              id={id()}
              class="settings-select"
              disabled={locked()}
              aria-labelledby={labelId()}
              onChange={(e) => write(e.currentTarget.value)}
            >
              <For each={choices()}>
                {(c) => (
                  <option value={c.json} selected={json() === c.json}>
                    {c.label}
                  </option>
                )}
              </For>
            </select>
          </Match>
          <Match when={props.entry.spec.kind === "choice"}>
            <div id={id()} class="settings-choices" role="radiogroup" aria-labelledby={labelId()}>
              <For each={choices()}>
                {(c) => (
                  <label class="settings-choice">
                    <input
                      type="radio"
                      name={id()}
                      value={c.json}
                      checked={json() === c.json}
                      disabled={locked()}
                      onChange={() => write(c.json)}
                    />
                    <span>{c.label}</span>
                  </label>
                )}
              </For>
            </div>
          </Match>
        </Switch>
      </div>
      <Show when={locked()}>
        <p class="settings-note">Only the global settings can set this.</p>
      </Show>
      <Show when={props.settings.scope() === "global" && props.state.source === "course"}>
        <p class="settings-note">This course sets its own value, which stays in force here.</p>
      </Show>
      <Show when={error()}>
        {(message) => (
          <p class="settings-error" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </div>
  );
}
