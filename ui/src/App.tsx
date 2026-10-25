import { Show } from "solid-js";
import { CoursePanel } from "./features/course/CoursePanel";
import { createAppInfo } from "./state/appInfo";
import { createCourse } from "./state/course";
import "./App.css";

/**
 * The app frame (docs/design/components.md#app-frame): headerbar, then rail · document · side
 * panel, with the status line along the bottom of the document column. Later features fill
 * each region.
 */
export function App() {
  const info = createAppInfo();
  const course = createCourse();
  return (
    <div class="app-frame">
      <header class="headerbar">
        <h1 class="headerbar-title">{info()?.name ?? "Lecter"}</h1>
      </header>
      <nav class="rail" aria-label="Course rail">
        <CoursePanel state={course} />
      </nav>
      <div class="document-column">
        <main class="buffer" aria-label="Document" />
        <footer class="status-line" role="status" aria-label="Status line">
          <Show when={info()} fallback={<span>Connecting to core…</span>}>
            {(i) => <span>v{i().version}</span>}
          </Show>
        </footer>
      </div>
      <aside class="side-panel" aria-label="Side panel" />
    </div>
  );
}
