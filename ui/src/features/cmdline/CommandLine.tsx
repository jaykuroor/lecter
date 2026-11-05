// The command line box (docs/design/components.md#cmdline): `:` in the buffer opens it centred at
// 16% from the top, a `:` prompt and the line, the completions under it (Tab takes one, ↑/↓ pick,
// a click takes it too), Enter runs, Esc (or Backspace on an empty line) closes. A command's
// answer stays a few seconds as a message at the bottom of the document.
import { For, Show } from "solid-js";
import type { Cmdline } from "./state";
import "./Cmdline.css";

const LIST_ID = "cmdline-completions";
const optionId = (i: number) => `cmdline-option-${i}`;

export function CommandLine(props: { cmdline: Cmdline }) {
  const c = props.cmdline;
  let input: HTMLInputElement | undefined;

  const onKeyDown = (e: KeyboardEvent) => {
    const key = e.key;
    if (key === "Enter") c.submit();
    else if (key === "Escape" || (key === "Backspace" && c.text() === "")) c.close();
    else if (key === "Tab") c.take();
    else if (key === "ArrowDown") c.move(1);
    else if (key === "ArrowUp") c.move(-1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <>
      <Show when={c.isOpen()}>
        <div class="cmdline" role="dialog" aria-label="Command line">
          <span class="cmdline-notch" aria-hidden="true">
            Cmdline
          </span>
          <div class="cmdline-row">
            <span class="cmdline-prompt" aria-hidden="true">
              :
            </span>
            <input
              ref={(el) => {
                input = el;
                // Focus once it is in the page, before the next key: the keys typed right after `:`
                // must land here, not in the buffer.
                queueMicrotask(() => el.focus());
              }}
              class="cmdline-input"
              type="text"
              role="combobox"
              aria-label="Command"
              aria-autocomplete="list"
              aria-controls={LIST_ID}
              aria-expanded={c.completions().length > 0}
              aria-activedescendant={c.picked() >= 0 ? optionId(c.picked()) : undefined}
              autocomplete="off"
              spellcheck={false}
              value={c.text()}
              onInput={(e) => c.setText(e.currentTarget.value)}
              onKeyDown={onKeyDown}
            />
          </div>
          <Show when={c.refusal()}>
            {(r) => (
              <p class="cmdline-refusal" role="alert">
                {r()}
              </p>
            )}
          </Show>
          <div id={LIST_ID} class="cmdline-completions" role="listbox" aria-label="Completions">
            <For each={c.completions()}>
              {(item, i) => (
                <div
                  id={optionId(i())}
                  class="cmdline-completion"
                  role="option"
                  tabIndex={-1}
                  aria-selected={c.picked() === i()}
                  onMouseDown={(e) => {
                    // Keep the focus in the line.
                    e.preventDefault();
                    c.take(i());
                    input?.focus();
                  }}
                >
                  <span class="cmdline-completion-label">{item.label}</span>
                  <span class="cmdline-completion-detail">{item.detail}</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
      <Show when={c.message()}>
        {(m) => (
          <div class={m().error ? "cmdline-message cmdline-message-error" : "cmdline-message"} role="status">
            <span class="cmdline-message-line">{m().line}</span>
            <Show when={m().note}>{(note) => <span class="cmdline-message-note">{note()}</span>}</Show>
          </div>
        )}
      </Show>
    </>
  );
}
