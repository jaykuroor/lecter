import { createEffect, createSignal, lazy, onCleanup, onMount, Show } from "solid-js";
import { readKeymaps } from "./core/keymaps";
import { markStartup } from "./core/startup";
import { DetailsForm } from "./features/course/details/DetailsForm";
import { FindPanel } from "./features/find/FindPanel";
import { RailColumn } from "./features/rail/RailColumn";
import { loadSidebar } from "./features/sidebar/load";
import { SidebarToggle } from "./features/sidebar/SidebarToggle";
import { TrustScreen } from "./features/trust/TrustScreen";
import { bootKeys } from "./keys/boot";
import { registerCommand } from "./keys/commands";
import { isMacPlatform } from "./keys/platform";
import { createAppInfo } from "./state/appInfo";
import { createCourse } from "./state/course";
import { createFind } from "./state/find";
import { createLayout } from "./state/layout";
import { createLecture } from "./state/lecture";
import { createRail } from "./state/rail";
import "./App.css";

// The buffer (CodeMirror and Vim) is a chunk of its own: the shell paints without it, and it
// loads right after that first paint, long before a lecture can be picked (cold_open_ms,
// 14-quality.md#performance-budgets). `:find` is defined on Vim's Ex table, which comes with it.
// One load per page, shared: what waits on it directly runs before the buffer renders from it.
let editor: Promise<
  [
    typeof import("./features/buffer/Buffer"),
    typeof import("./features/find/exCommand"),
    typeof import("./features/buffer/prewarm"),
  ]
>;
const loadEditor = () =>
  (editor ??= Promise.all([
    import("./features/buffer/Buffer"),
    import("./features/find/exCommand"),
    import("./features/buffer/prewarm"),
  ]));
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
 * buffer's chunk, defines `:find` and pre-warms the editor (features/buffer/prewarm.ts). The first
 * lecture's paint is reported too (`startup buffer-first-paint`).
 */
export function App() {
  const [painted, setPainted] = createSignal(false);
  const info = createAppInfo(painted);
  const course = createCourse();
  const rail = createRail();
  const lecture = createLecture();
  const find = createFind();
  // The sidebar (F-036): ␣e or the headerbar button toggles it, and the next start keeps it (D-195).
  const layout = createLayout();
  // `:find words` in the buffer and the Find field both search the open course (F-022).
  const runFind = (words: string) => void find.run(course.course()?.path ?? null, words);

  // Keys (F-037): the engine's listener is on from the start; the engine loads after the first
  // paint and takes the keys held back until then (keys/boot.ts).
  const mac = isMacPlatform();
  const keys = bootKeys(window, mac);
  const dropCommands = [
    registerCommand("sidebar.toggle", () => {
      layout.toggleSidebar();
    }),
    // Ctrl/Cmd-1…9: the nth course on the rail; without one the key goes on as usual.
    registerCommand("course.go", ({ binding }) => {
      const known = rail.courses()[binding.arg as number];
      if (!known) return false;
      void course.switchTo(known.path);
      return true;
    }),
  ];
  let documentColumn: HTMLDivElement | undefined;
  // What was wrong with keymaps.jsonc, shown once in the status line (D-199).
  const [keyNotice, setKeyNotice] = createSignal<string[]>([]);

  let gone = false;
  let dropFind: (() => void) | undefined;
  let stopKeys: (() => void) | undefined;
  onCleanup(() => {
    gone = true;
    dropFind?.();
    keys.stop();
    stopKeys?.();
    for (const drop of dropCommands) drop();
  });
  onMount(() => {
    void afterPaint().then(() => {
      if (gone) return;
      markStartup("shell_first_paint");
      void import("./keys/install").then(({ startKeys }) => {
        if (gone) return;
        const started = startKeys({ mac, host: documentColumn as HTMLDivElement });
        stopKeys = started.stop;
        keys.attach(started.handle);
        // keymaps.jsonc comes after: the default keys work until it is in, and stay when it
        // can't be used. Nothing on the key path waits for it.
        void readKeymaps().then((read) => {
          if (gone) return;
          setKeyNotice(read.status === "ok" ? started.setUserKeymap(read.data) : [read.error.message]);
        });
      });
      // Renders the buffer, which starts loading its chunk; `:find` is defined before it shows.
      setPainted(true);
      // The course rail's courses and the saved layout (state.db) aren't needed for the first
      // paint: no course is open yet, so the sidebar has nothing to show.
      void rail.load();
      void layout.load();
      // The sidebar's chunk, so it is in by the time a course opens (features/sidebar/load.ts).
      void loadSidebar();
      void loadEditor().then(([, ex, warm]) => {
        if (gone) return;
        dropFind = ex.registerFindCommand(runFind);
        // Runs the editor's code once while nothing is open, so the first lecture opens faster.
        if (!lecture.lecture()) warm.prewarmEditor();
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
        <div class="headerbar-start">
          <SidebarToggle shown={layout.sidebar()} onToggle={layout.toggleSidebar} />
        </div>
        <h1 class="headerbar-title">{info()?.name ?? "Lecter"}</h1>
      </header>
      <nav class="rail" aria-label="Course rail">
        <RailColumn
          course={course}
          rail={rail}
          onOpenLecture={(path, file) => void lecture.open(path, file)}
          openLecture={lecture.lecture()?.path ?? null}
          sidebarShown={layout.sidebar()}
        />
      </nav>
      <div class="document-column" ref={documentColumn}>
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
        {/* The first open of a folder, or one that moved or whose AI files changed, asks (F-033). */}
        <Show when={course.course()?.trust === "ask" ? course.course() : null}>
          {(c) => (
            <TrustScreen
              name={c().name}
              path={c().path}
              screen={c().screen}
              busy={course.busy()}
              onAnswer={(choice) => void course.answer(choice)}
            />
          )}
        </Show>
        {/* Right after Trust, for a course whose details were never saved (F-034). */}
        <Show when={course.course()}>
          {(c) => (
            <Show when={course.details()}>
              {(d) => (
                <DetailsForm
                  folder={c().name}
                  details={d()}
                  busy={course.busy()}
                  error={course.detailsError()}
                  onSave={(values) => void course.saveDetails(values)}
                  onSkip={course.skipDetails}
                />
              )}
            </Show>
          )}
        </Show>
        <footer class="status-line" role="status" aria-label="Status line">
          <Show when={info()} fallback={<span>Connecting to core…</span>}>
            {(i) => <span>v{i().version}</span>}
          </Show>
          <Show when={keyNotice()[0]}>
            {(first) => (
              <span class="keys-notice" title={keyNotice().join("\n")}>
                {keyNotice().length > 1 ? `${first()} (+${keyNotice().length - 1} more)` : first()}
              </span>
            )}
          </Show>
        </footer>
      </div>
      <aside class="side-panel" aria-label="Side panel">
        <FindPanel state={find} onFind={runFind} />
      </aside>
    </div>
  );
}
