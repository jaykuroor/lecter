import { EditorView } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";
import { createEffect, createSignal, type JSX, onCleanup, Show } from "solid-js";
import type { Lecture } from "../../core/lecture";
import { lectureState } from "./editorState";
import { registerElementMotions } from "./vim";
import "./Buffer.css";

/** The Vim mode the buffer is in, as `vim-mode-change` reports it. */
type Mode = "normal" | "insert" | "visual" | "replace";

/**
 * The lecture buffer (09-ui.md#layout, docs/design/components.md#buffer): the open lecture's file
 * in one CodeMirror editor with Vim keys. Slide headings and blocks are decorations over the file's
 * text (decorations.ts). `data-vim-mode` carries the mode for the status line and tests.
 */
export function Buffer(props: { lecture: Lecture | null; error: string | null }): JSX.Element {
  registerElementMotions();
  const [mode, setMode] = createSignal<Mode>("normal");
  let host: HTMLDivElement | undefined;
  let view: EditorView | undefined;

  /** Follows Vim's mode; the listener goes with the state, so it is added for each lecture. */
  function followMode(v: EditorView): void {
    setMode("normal");
    getCM(v)?.on("vim-mode-change", (e: { mode: Mode }) => setMode(e.mode));
  }

  createEffect(() => {
    const lecture = props.lecture;
    if (!lecture || !host) return;
    const state = lectureState(lecture.text, `Lecture ${lecture.name}`);
    if (view) view.setState(state);
    else view = new EditorView({ state, parent: host });
    followMode(view);
    view.focus();
  });
  onCleanup(() => view?.destroy());

  return (
    <div class="lecture-buffer" data-vim-mode={mode()} data-lecture={props.lecture?.path ?? ""}>
      <Show when={props.error}>
        {(message) => (
          <p class="buffer-error" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <Show when={!props.lecture}>
        <p class="buffer-empty">Open a lecture from the rail.</p>
      </Show>
      <div class="buffer-editor" ref={host} />
    </div>
  );
}
