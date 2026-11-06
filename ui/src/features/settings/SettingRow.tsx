// One setting in the Settings window: its label, description and dotted key (what `:set` takes),
// where its value comes from, and a control for its kind: a switch for on/off, choices for a fixed
// set (a list for more than four), a field for numbers, text and lists, committed on Enter or when
// the focus leaves. `ui.performance` and `ui.theme` have controls of their own. A value is checked
// against the schema before it is written; the core's refusal shows under the setting.
import { For, type JSX, Match, Show, Switch } from "solid-js";
import { checkValue, showValue } from "../cmdline/schema";
import type { Entry } from "./filter";
import { PerformancePreset } from "./PerformancePreset";
import { choiceLabel } from "./pages";
import type { SettingsWindow } from "./state";

/** Choices up to this many show as buttons; more as a list. */
const MAX_BUTTONS = 4;

/** The control's id for `key` (labels point at it). */
export const controlId = (key: string): string => `setting-${key.replace(/\./g, "-")}`;

/** What the source badge says: where the value in force comes from. */
const SOURCE_WORDS: Readonly<Record<string, string>> = {
  default: "default",
  global: "global",
  course: "this course",
  role: "role file",
  prompt: "prompt",
};

/** The JSON value of `json`, or `undefined` for text that isn't JSON. */
function parsed(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

export function SettingRow(props: { entry: Entry; settings: SettingsWindow }): JSX.Element {
  const key = () => props.entry.spec.key;
  const state = () => props.settings.values()[key()];
  const json = () => state()?.value ?? "null";
  const id = () => controlId(key());
  const labelId = () => `${id()}-label`;
  /** A course can't set it (SEC-25) and the window writes to the course. */
  const locked = () => props.settings.scope() === "course" && state()?.globalOnly === true;
  const disabled = () => locked() || state() === undefined;
  const error = () => props.settings.errors()[key()];
  const write = (value: string) => {
    if (value !== json()) void props.settings.write(key(), value);
  };
  /** Checks typed text against the schema; a refusal shows under the setting without a write. */
  const commit = (text: string) => {
    if (text === showValue(json()) || (text === "" && json() === "null")) return;
    const checked = checkValue(props.entry.spec, text);
    if (checked.ok) write(checked.json);
    else props.settings.setError(key(), checked.reason);
  };
  const fieldText = () => (json() === "null" ? "" : showValue(json()));
  const choices = () => [...props.entry.spec.choices, ...(props.entry.spec.nullable ? ["null"] : [])];
  const choiceText = (c: string) => (c === "null" ? "Not set" : choiceLabel(c));
  const choiceJson = (c: string) => (c === "null" ? "null" : JSON.stringify(c));

  const field = () => (
    <input
      id={id()}
      class="settings-field"
      type="text"
      inputmode={props.entry.spec.kind === "integer" || props.entry.spec.kind === "number" ? "decimal" : "text"}
      value={fieldText()}
      disabled={disabled()}
      aria-labelledby={labelId()}
      aria-invalid={error() ? "true" : undefined}
      placeholder={props.entry.spec.kind === "list" ? "a, b, c" : props.entry.spec.nullable ? "Not set" : ""}
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
    <div class="settings-row" data-key={key()}>
      <div class="settings-row-text">
        <span class="settings-label" id={labelId()}>
          {props.entry.label}
        </span>
        <Show when={props.entry.spec.description}>
          <span class="settings-desc">{props.entry.spec.description}</span>
        </Show>
        <span class="settings-meta">
          <code class="settings-key">{key()}</code>
          <Show when={state()}>{(s) => <span class="settings-source">{SOURCE_WORDS[s().source]}</span>}</Show>
        </span>
      </div>
      <div class="settings-control">
        <Switch fallback={field()}>
          <Match when={key() === "ui.performance"}>
            <PerformancePreset
              value={String(parsed(json()))}
              name={id()}
              labelledBy={labelId()}
              disabled={disabled()}
              onPick={(v) => write(JSON.stringify(v))}
            />
          </Match>
          <Match when={key() === "ui.theme"}>
            <select
              id={id()}
              class="settings-select"
              disabled={disabled()}
              aria-labelledby={labelId()}
              onChange={(e) => write(e.currentTarget.value === "" ? "null" : JSON.stringify(e.currentTarget.value))}
            >
              <option value="" selected={json() === "null"}>
                Follow the desktop
              </option>
              <For each={themeNames(props.settings.themes(), parsed(json()))}>
                {(name) => (
                  <option value={name} selected={parsed(json()) === name}>
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
              disabled={disabled()}
              aria-labelledby={labelId()}
              onChange={(e) => write(e.currentTarget.checked ? "true" : "false")}
            />
          </Match>
          <Match when={props.entry.spec.kind === "choice" && choices().length > MAX_BUTTONS}>
            <select
              id={id()}
              class="settings-select"
              disabled={disabled()}
              aria-labelledby={labelId()}
              onChange={(e) => write(e.currentTarget.value)}
            >
              <For each={choices()}>
                {(c) => (
                  <option value={choiceJson(c)} selected={json() === choiceJson(c)}>
                    {choiceText(c)}
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
                      value={choiceJson(c)}
                      checked={json() === choiceJson(c)}
                      disabled={disabled()}
                      onChange={() => write(choiceJson(c))}
                    />
                    <span>{choiceText(c)}</span>
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
      <Show when={props.settings.scope() === "global" && state()?.source === "course"}>
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

/** The themes to list: the installed ones, and the one set now even when it isn't installed. */
function themeNames(installed: readonly string[], current: unknown): string[] {
  return typeof current === "string" && !installed.includes(current) ? [...installed, current] : [...installed];
}
