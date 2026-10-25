import { For, type JSX, Show } from "solid-js";
import type { CourseFile } from "../../core/course";
import type { CourseState } from "../../state/course";
import "./CoursePanel.css";

/**
 * The opened course in the rail (02-course-folder.md, 09-ui.md#layout): an Open button, then the
 * course's name and its `lectures/` and `slides/` files. The course rail (F-035) and the trust
 * screen (F-033) replace this skeleton.
 */
export function CoursePanel(props: { state: CourseState }): JSX.Element {
  return (
    <div class="course-panel">
      <button
        type="button"
        class="course-open"
        title="Open a course folder"
        disabled={props.state.busy()}
        onClick={() => void props.state.open()}
      >
        <span aria-hidden="true">+</span> Open course folder
      </button>
      <Show when={props.state.error()}>
        {(message) => (
          <p class="course-error" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <Show when={props.state.course()}>
        {(course) => (
          <section class="course" aria-label={`Course ${course().name}`}>
            <h2 class="course-name" title={course().path}>
              {course().name}
            </h2>
            <FileList label="Lectures" empty="No lectures yet" files={course().lectures} />
            <FileList label="Slides" empty="No slides yet" files={course().slides} />
          </section>
        )}
      </Show>
    </div>
  );
}

function FileList(props: { label: string; empty: string; files: CourseFile[] }): JSX.Element {
  return (
    <section class="course-section" aria-label={props.label}>
      <h3 class="rlab">
        {props.label} <span class="course-count">{props.files.length}</span>
      </h3>
      <Show when={props.files.length > 0} fallback={<p class="course-empty">{props.empty}</p>}>
        <ul class="course-files">
          <For each={props.files}>
            {(f) => (
              <li class="course-file" title={f.path}>
                {f.name}
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
