import { For, type JSX, Show } from "solid-js";
import type { CourseFile } from "../../core/course";
import type { CourseState } from "../../state/course";
import { ReadOnlyChip } from "../trust/TrustScreen";
import "./CoursePanel.css";

/**
 * The opened course under the course rail (02-course-folder.md, 09-ui.md#layout): the course's
 * name (with a Read-only chip when it was opened read-only, F-033) and its `lectures/` and
 * `slides/` files. The rail's `+` opens a course (F-035); the sidebar (F-036) replaces this list.
 */
export function CoursePanel(props: {
  state: CourseState;
  /** Opens a lecture (its course-relative path) of the course (its path) in the buffer. */
  onOpenLecture: (course: string, path: string) => void;
  /** The lecture in the buffer, highlighted in the list. */
  openLecture: string | null;
}): JSX.Element {
  return (
    <div class="course-panel">
      <Show when={props.state.course()}>
        {(course) => (
          <section class="course" aria-label={`Course ${course().name}`}>
            <h2 class="course-name" title={course().path}>
              {course().name}
              <Show when={course().trust === "read_only"}>
                {" "}
                <ReadOnlyChip />
              </Show>
            </h2>
            <FileList
              label="Lectures"
              empty="No lectures yet"
              files={course().lectures}
              onOpen={(path) => props.onOpenLecture(course().path, path)}
              current={props.openLecture}
            />
            <FileList label="Slides" empty="No slides yet" files={course().slides} />
          </section>
        )}
      </Show>
    </div>
  );
}

/**
 * Enter and Space activate a row button in the app's own handler: the browser's button activation
 * runs only for trusted key events, so a synthetic key (the embedded WebDriver, assistive tools)
 * would never open the file. preventDefault stops a real keypress from also clicking.
 */
function onActivateKey(e: KeyboardEvent, activate: () => void): void {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  activate();
}

function FileList(props: {
  label: string;
  empty: string;
  files: CourseFile[];
  /** Makes each row a button that opens its file. */
  onOpen?: (path: string) => void;
  current?: string | null;
}): JSX.Element {
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
                <Show when={props.onOpen} fallback={f.name}>
                  {(open) => (
                    <button
                      type="button"
                      class="course-file-open"
                      aria-current={props.current === f.path ? "page" : undefined}
                      onClick={() => open()(f.path)}
                      onKeyDown={(e) => onActivateKey(e, () => open()(f.path))}
                    >
                      {f.name}
                    </button>
                  )}
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
