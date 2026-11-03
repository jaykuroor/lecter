import { createEffect, createSignal, lazy, onCleanup, onMount, Show } from "solid-js";
import { markStartup } from "./core/startup";
import { CoursePanel } from "./features/course/CoursePanel";
import { FindPanel } from "./features/find/FindPanel";
import { createAppInfo } from "./state/appInfo";
import { createCourse } from "./state/course";
import { createFind } from "./state/find";
import { createLecture } from "./state/lecture";
import "./App.css";

// The buffer (CodeMirror and Vim) is a chunk of its own: the shell paints without it, and it
// loads right after that first paint, long before a lecture can be picked (cold_open_ms,
// 14-quality.md#performance-budgets). `:find` is defined on Vim's Ex table, which comes with it.
// One load per page, shared: what waits on it directly runs before the buffer renders from it.
let editor: Promise<[typeof import("./features/buffer/Buffer"), typeof import("./features/find/exCommand")]>;
const loadEditor = () =>
  (editor ??= Promise.all([import("./features/buffer/Buffer"), import("./features/find/exCommand")]));
const Buffer = lazy(() => loadEditor().then(([buffer]) => ({ default: buffer.Buffer })));

/**
 * Resolves just after the next frame is on screen: a `requestAnimationFrame` callback runs right
 * before the frame is painted, and a message posted from it is delivered once the frame is done.
 */
function afterPaint(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(null);
    }),
  );
}

/**
 * The app frame (docs/design/components.md#app-frame): headerbar, then rail · document · side
 * panel, with the status line along the bottom of the document column. Later features fill
 * each region.
 *
 * Startup: only what the first paint shows runs before it. After it, the UI tells the core it
 * painted (`startup shell-first-paint`), and only then asks for the app's version, loads the
 * buffer's chunk and defines `:find`. The first lecture's paint is reported too
 * (`startup buffer-first-paint`).
 */
export function App() {
  const [painted, setPainted] = createSignal(false);
  const info = createAppInfo(painted);
  const course = createCourse();
  const lecture = createLecture();
  const find = createFind();
  // `:find words` in the buffer and the Find field both search the open course (F-022).
  const runFind = (words: string) => void find.run(course.course()?.path ?? null, words);

  let gone = false;
  let dropFind: (() => void) | undefined;
  onCleanup(() => {
    gone = true;
    dropFind?.();
  });
  onMount(() => {
    void afterPaint().then(() => {
      if (gone) return;
      markStartup("shell_first_paint");
      // Renders the buffer, which starts loading its chunk; `:find` is defined before it shows.
      setPainted(true);
      void loadEditor().then(([, ex]) => {
        if (!gone) dropFind = ex.registerFindCommand(runFind);
      });
    });
  });

  // The first lecture on screen: its buffer exists once the chunk is in and the lecture is set.
  let bufferMarked = false;
  createEffect(() => {
    if (bufferMarked || !lecture.lecture()) return;
    bufferMarked = true;
    void loadEditor()
      .then(() => afterPaint())
      .then(() => {
        if (!gone) markStartup("buffer_first_paint");
      });
  });

  return (
    <div class="app-frame">
      <header class="headerbar">
        <h1 class="headerbar-title">{info()?.name ?? "Lecter"}</h1>
      </header>
      <nav class="rail" aria-label="Course rail">
        <CoursePanel
          state={course}
          onOpenLecture={(path, file) => void lecture.open(path, file)}
          openLecture={lecture.lecture()?.path ?? null}
        />
      </nav>
      <div class="document-column">
        <main class="buffer" aria-label="Document">
          <Show when={painted()}>
            <Buffer
              lecture={lecture.lecture()}
              course={course.course()?.path ?? null}
              error={lecture.error()}
              onEdits={lecture.edit}
            />
          </Show>
        </main>
        <footer class="status-line" role="status" aria-label="Status line">
          <Show when={info()} fallback={<span>Connecting to core…</span>}>
            {(i) => <span>v{i().version}</span>}
          </Show>
        </footer>
      </div>
      <aside class="side-panel" aria-label="Side panel">
        <FindPanel state={find} onFind={runFind} />
      </aside>
    </div>
  );
}
