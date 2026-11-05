import { createSignal, For, type JSX, onMount, Show } from "solid-js";
import type { CourseDetails } from "../../../core/course";
import "./DetailsForm.css";

type Field = "name" | "code" | "term" | "professor" | "color" | "icon";
type FolderField = keyof CourseDetails["folders"];

/** The fields, in form order, with their labels and limits (the core checks them again). */
const FIELDS: { key: Field; label: string; type: "text" | "color"; max: number; hint?: string }[] = [
  { key: "name", label: "Name", type: "text", max: 200 },
  { key: "code", label: "Code", type: "text", max: 200 },
  { key: "term", label: "Term", type: "text", max: 200 },
  { key: "professor", label: "Professor", type: "text", max: 200 },
  { key: "color", label: "Colour", type: "color", max: 7 },
  {
    key: "icon",
    label: "Icon",
    type: "text",
    max: 255,
    hint: "A letter, or an image in .lecter/ (e.g. .lecter/icon.png)",
  },
];

/** The folder mapping, with the folder each one holds. */
const FOLDERS: { key: FolderField; label: string }[] = [
  { key: "slides", label: "Slides" },
  { key: "sources", label: "Sources" },
  { key: "lectures", label: "Lectures" },
  { key: "pastPapers", label: "Past papers" },
];

/**
 * The course details form (02-course-folder.md#course-details-coursejsonc): shown over the
 * document right after the user trusts a course whose details were never saved. It collects the
 * name, code, term, professor, icon, colour and folder mapping, starting from the core's guesses
 * from the folder names. Save writes `.lecter/course.jsonc`; Later closes it and writes nothing.
 *
 * Mouse: the fields and both buttons. Keys: Tab between fields, Enter saves, Escape is Later; the
 * buttons show both keys. Focus starts in Name.
 */
export function DetailsForm(props: {
  /** The course folder's name, for the title. */
  folder: string;
  /** The form's first values. */
  details: CourseDetails;
  /** A save is in progress. */
  busy: boolean;
  /** Why the last save failed. */
  error: string | null;
  onSave: (details: CourseDetails) => void;
  onSkip: () => void;
}): JSX.Element {
  // The form's own copy: the first values are where it starts, not what it keeps.
  const [values, setValues] = createSignal<CourseDetails>(structuredClone(props.details));
  const setText = (key: Field, value: string) => setValues((v) => ({ ...v, [key]: value }));
  const setFolder = (key: FolderField, value: string) =>
    setValues((v) => ({ ...v, folders: { ...v.folders, [key]: value } }));
  const named = () => values().name.trim() !== "";

  let first!: HTMLInputElement;
  onMount(() => {
    first.focus();
    first.select();
  });

  const save = () => {
    if (props.busy || !named()) return;
    props.onSave(values());
  };
  // Enter and Escape are handled here, not left to the browser's implicit submission, which runs
  // only for trusted key events (a synthetic key from the embedded WebDriver would do nothing).
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onSkip();
    } else if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      save();
    }
  };

  return (
    <form
      class="details"
      role="dialog"
      aria-labelledby="details-title"
      aria-describedby="details-intro"
      onKeyDown={keys}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <header class="details-head">
        <span class="details-icon" style={{ "--c": values().color }} aria-hidden="true">
          {values().icon.startsWith(".lecter/") ? "" : values().icon}
        </span>
        <div>
          <h2 id="details-title" class="details-title">
            Course details
          </h2>
          <p id="details-intro" class="details-intro">
            For “{props.folder}”, saved in .lecter/course.jsonc. You can change them later in that file.
          </p>
        </div>
      </header>
      <div class="details-grid">
        <For each={FIELDS}>
          {(f) => (
            <div class="details-field" classList={{ wide: f.key === "name" || f.key === "icon" }}>
              <label class="details-label" for={`details-${f.key}`}>
                {f.label}
              </label>
              <input
                ref={(el) => {
                  if (f.key === "name") first = el;
                }}
                id={`details-${f.key}`}
                class={f.type === "color" ? "details-color" : "details-input"}
                type={f.type}
                name={f.key}
                maxLength={f.max}
                required={f.key === "name"}
                spellcheck={false}
                autocomplete="off"
                aria-describedby={f.hint ? `details-${f.key}-hint` : undefined}
                value={values()[f.key]}
                onInput={(e) => setText(f.key, e.currentTarget.value)}
              />
              <Show when={f.hint}>
                {(hint) => (
                  <span id={`details-${f.key}-hint`} class="details-hint">
                    {hint()}
                  </span>
                )}
              </Show>
            </div>
          )}
        </For>
      </div>
      <fieldset class="details-folders">
        <legend class="details-label">Folders</legend>
        <div class="details-grid">
          <For each={FOLDERS}>
            {(f) => (
              <label class="details-field">
                <span class="details-label">{f.label}</span>
                <input
                  class="details-input details-path"
                  type="text"
                  name={`folders.${f.key}`}
                  maxLength={255}
                  spellcheck={false}
                  autocomplete="off"
                  value={values().folders[f.key]}
                  onInput={(e) => setFolder(f.key, e.currentTarget.value)}
                />
              </label>
            )}
          </For>
        </div>
      </fieldset>
      <Show when={props.error}>
        {(why) => (
          <p class="details-error" role="alert">
            {why()}
          </p>
        )}
      </Show>
      <div class="details-actions">
        <button type="button" class="btn" disabled={props.busy} onClick={() => props.onSkip()}>
          Later <kbd class="details-key">Esc</kbd>
        </button>
        <button type="submit" class="btn sug" disabled={props.busy || !named()}>
          Save <kbd class="details-key">Enter</kbd>
        </button>
      </div>
    </form>
  );
}
