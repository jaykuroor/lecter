import { createEffect, createSignal, lazy, onCleanup, onMount, Show } from "solid-js";
import { readKeymaps } from "./core/keymaps";
import { getSetting, onSettingsChanged, setSetting } from "./core/settings";
import { markStartup } from "./core/startup";
import { DetailsForm } from "./features/course/details/DetailsForm";
import { FindPanel } from "./features/find/FindPanel";
import { ReadModeToggle } from "./features/overlay/ReadModeToggle";
import { createReadMode } from "./features/overlay/readMode";
import { PaletteButtons } from "./features/palette/PaletteButtons";
import { registerPalette } from "./features/palette/register";
import { RailColumn } from "./features/rail/RailColumn";
import { type Follower, followSetting } from "./features/settings/follow";
import { registerSettings } from "./features/settings/register";
import { SettingsButton } from "./features/settings/SettingsButton";
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
// 14-quality.md#performance-budgets). `:find` is defined on Vim's Ex table, which comes with it,
// and the command line `:` opens (F-040) comes beside it.
// One load per page, shared: what waits on it directly runs before the buffer renders from it.
let editor: Promise<
  [
    typeof import("./features/buffer/Buffer"),
    typeof import("./features/find/exCommand"),
    typeof import("./features/buffer/prewarm"),
    typeof import("./features/overlay/readEx"),
    typeof import("./features/cmdline/mount"),
  ]
>;
const loadEditor = () =>
  (editor ??= Promise.all([
    import("./features/buffer/Buffer"),
    import("./features/find/exCommand"),
    import("./features/buffer/prewarm"),
    import("./features/overlay/readEx"),
    import("./features/cmdline/mount"),
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
  // Read mode (F-039): ␣ur, `:read` or the headerbar's button hide the rail, sidebar, hint bar and
  // keystroke overlay, and show them again.
  const readMode = createReadMode();
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
    registerCommand("ui.readMode", () => {
      readMode.toggle();
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
  let dropRead: (() => void) | undefined;
  let stopCmdline: (() => void) | undefined;
  let stopWarm: (() => void) | undefined;
  let cmdlineHost: HTMLDivElement | undefined;
  let stopKeys: (() => void) | undefined;
  let stopPalette: (() => void) | undefined;
  let paletteHost: HTMLDivElement | undefined;
  let stopSettings: (() => void) | undefined;
  let settingsHost: HTMLDivElement | undefined;
  // `ui.hintBar` and `ui.keystrokes` as they change (F-045).
  const follows: Follower[] = [];
  const coursePath = () => course.course()?.path ?? null;
  const settingsCore = { get: getSetting, listen: onSettingsChanged };
  let hints: { refresh: () => void; stop: () => void } | undefined;
  let hintHost: HTMLDivElement | undefined;
  let overlay: { typed: (e: KeyboardEvent) => void; stop: () => void } | undefined;
  let overlayHost: HTMLDivElement | undefined;
  let stopTheme: (() => void) | undefined;
  onCleanup(() => {
    gone = true;
    stopTheme?.();
    dropFind?.();
    dropRead?.();
    stopCmdline?.();
    stopWarm?.();
    keys.stop();
    hints?.stop();
    overlay?.stop();
    stopKeys?.();
    stopPalette?.();
    stopSettings?.();
    for (const follow of follows) follow.stop();
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
        // Each key goes to the engine, then to the keystroke overlay, which only queues it.
        keys.attach((e) => {
          started.handle(e);
          overlay?.typed(e);
        });
        // Ctrl/Cmd-Shift-P and Ctrl/Cmd-p (F-041): the palette's chunk starts loading now and lists
        // the engine's keymap; the switcher, the rail's courses and the open course's files.
        stopPalette = registerPalette({
          host: paletteHost as HTMLDivElement,
          mac,
          bindings: () => started.engine.map.bindings,
          courses: rail.courses,
          course: course.course,
          openCourse: (path) => void course.switchTo(path),
          openLecture: (path, file) => void lecture.open(path, file),
          sidebarShown: layout.sidebar,
          showSidebar: layout.toggleSidebar,
        });
        // Ctrl/Cmd-, and the headerbar's button (F-045): Settings, a chunk that loads on first open.
        stopSettings = registerSettings({
          host: settingsHost as HTMLDivElement,
          mac,
          bindings: () => started.engine.map.bindings,
          course: course.course,
        });
        // The hint bar (F-038) reads the engine's keymap; its chunk comes after the engine's. It
        // follows `ui.hintBar`, and ␣uh writes it (F-045).
        void import("./features/hints/mount").then(({ startHintBar, detailOf }) => {
          if (gone) return;
          const bar = startHintBar({
            engine: started.engine,
            host: hintHost as HTMLDivElement,
            onDetail: (d) => {
              follow.touched();
              void setSetting("ui.hintBar", JSON.stringify(d), null);
            },
          });
          const follow = followSetting(settingsCore, "ui.hintBar", coursePath, (json) => bar.setDetail(detailOf(json)));
          hints = bar;
          follows.push(follow);
        });
        // The keystroke overlay (F-039) shows the keys the engine sees; its chunk comes after too.
        // It follows `ui.keystrokes`, and ␣uk writes it (F-045).
        void import("./features/overlay/mount").then(({ startOverlay }) => {
          if (gone) return;
          const shown = startOverlay({
            engine: started.engine,
            host: overlayHost as HTMLDivElement,
            mac,
            hidden: readMode.on,
            onToggle: (on) => {
              follow.touched();
              void setSetting("ui.keystrokes", on ? "true" : "false", null);
            },
          });
          const follow = followSetting(settingsCore, "ui.keystrokes", coursePath, (json) =>
            shown.setOn(json !== "false"),
          );
          overlay = shown;
          follows.push(follow);
        });
        // keymaps.jsonc comes after: the default keys work until it is in, and stay when it
        // can't be used. Nothing on the key path waits for it.
        void readKeymaps().then((read) => {
          setKeyNotice(read.status === "ok" ? started.setUserKeymap(read.data) : [read.error.message]);
          hints?.refresh();
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
      // The desktop's GTK theme, or `ui.theme` (F-043), after the first paint like every other
      // ask of the core: applied when the core answers, then on each change. A chunk of its own,
      // so none of it is in the first-paint chunk.
      void import("./theme/gtk")
        .then(({ followTheme }) => followTheme())
        .then(
          (stop) => {
            if (gone) stop();
            else stopTheme = stop;
          },
          () => {},
        );
      void loadEditor().then(([, ex, warm, read, cmdline]) => {
        if (gone) return;
        dropFind = ex.registerFindCommand(runFind);
        dropRead = read.registerReadCommand(readMode.toggle);
        stopCmdline = cmdline.startCmdline({
          host: cmdlineHost as HTMLDivElement,
          course: () => course.course()?.path ?? null,
        }).stop;
        // Runs the editor's code once while nothing is open, so the first lecture opens faster.
        if (!lecture.lecture()) stopWarm = warm.prewarmEditor();
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
    <div class={readMode.on() ? "app-frame read-mode" : "app-frame"}>
      <header class="headerbar">
        <div class="headerbar-start">
          <SidebarToggle shown={layout.sidebar()} onToggle={layout.toggleSidebar} />
        </div>
        <h1 class="headerbar-title">{info()?.name ?? "Lecter"}</h1>
        <div class="headerbar-end">
          <PaletteButtons mac={mac} />
          <ReadModeToggle on={readMode.on()} onToggle={readMode.toggle} />
          <SettingsButton mac={mac} />
        </div>
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
          {/* The keystroke overlay (F-039), bottom right of the buffer. */}
          <div class="keystroke-overlay-host" ref={overlayHost} />
          {/* The command line `:` opens (F-040), over the document. */}
          <div class="cmdline-host" ref={cmdlineHost} />
          {/* The command palette and quick switcher (F-041), over the window. */}
          <div class="palette-host" ref={paletteHost} />
          {/* The Settings window (F-045), over the window. */}
          <div class="settings-host" ref={settingsHost} />
        </main>
        {/* The hint bar (F-038): the keys that work now, one line above the status line. */}
        <div class="hint-bar-host" ref={hintHost} />
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
