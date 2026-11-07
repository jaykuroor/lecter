import { EditorView } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";
import { createEffect, createSignal, type JSX, onCleanup, Show } from "solid-js";
import { glossBackend } from "../../core/gloss";
import type { Edit, Lecture } from "../../core/lecture";
import { registerAppendKey } from "../../keys/append";
import { setBufferTarget } from "../../keys/locate";
import { bufferTarget, trimVimKeys } from "../../keys/vim";
import { trackJobs } from "../status/jobs";
import { slideAt, slideReport } from "../status/slide";
import type { BufferStatus } from "../status/state";
import { lectureState } from "./editorState";
import { registerElementMotions } from "./vim";
import "./Buffer.css";

/** The Vim mode the buffer is in, as `vim-mode-change` reports it. */
type Mode = "normal" | "insert" | "visual" | "replace";

/**
 * The lecture buffer (09-ui.md#layout, docs/design/components.md#buffer): the open lecture's file
 * in one CodeMirror editor with Vim keys. Slide headings and blocks are decorations over the file's
 * text (decorations.ts). `data-vim-mode` carries the mode for tests; the status line (F-046) hears
 * the mode, the cursor's slide and the answers' jobs through `status`. Every edit goes to `onEdits`
 * (edits.ts), which sends it to the core without waiting.
 */
export function Buffer(props: {
  lecture: Lecture | null;
  /** The course the lecture belongs to; with it, Enter on a slide or own-note line asks about it (F-023, F-048). */
  course?: string | null;
  error: string | null;
  /** Receives every edit, in order (F-021: the core journals and saves them). */
  onEdits?: (edits: Edit[]) => void;
  /** The status line's side: Vim's mode, the cursor's slide, the asks' jobs (F-046). */
  status?: BufferStatus;
}): JSX.Element {
  registerElementMotions();
  registerAppendKey();
  // Only the Vim keys 10-keymap.md keeps; the key engine (src/keys) does the Lecter ones.
  trimVimKeys();
  const [mode, setMode] = createSignal<Mode>("normal");
  const showMode = (m: Mode) => {
    setMode(m);
    props.status?.mode(m);
  };
  let root: HTMLDivElement | undefined;
  let host: HTMLDivElement | undefined;
  let view: EditorView | undefined;
  let dropTarget: (() => void) | undefined;

  /** Follows Vim's mode; the listener goes with the state, so it is added for each lecture. */
  function followMode(v: EditorView): void {
    showMode("normal");
    getCM(v)?.on("vim-mode-change", (e: { mode: Mode }) => showMode(e.mode));
  }

  createEffect(() => {
    const lecture = props.lecture;
    if (!lecture || !host) return;
    const course = props.course;
    const status = props.status;
    const backend = course ? glossBackend(course, lecture.path) : null;
    const gloss = backend && status ? trackJobs(backend, status.jobs) : backend;
    const state = lectureState(
      lecture.text,
      `Lecture ${lecture.name}`,
      (edits) => props.onEdits?.(edits),
      gloss,
      status ? slideReport(status.slide) : [],
    );
    if (view) view.setState(state);
    else {
      view = new EditorView({ state, parent: host });
      // One editor for every lecture: the key engine learns about it once.
      dropTarget = setBufferTarget(bufferTarget(view, root as HTMLDivElement));
    }
    followMode(view);
    status?.slide(slideAt(view.state));
    view.focus();
  });
  onCleanup(() => {
    dropTarget?.();
    view?.destroy();
  });

  return (
    <div class="lecture-buffer" ref={root} data-vim-mode={mode()} data-lecture={props.lecture?.path ?? ""}>
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
