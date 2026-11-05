import type { CommandName, Commands, IpcError } from "../../src/core/bindings";
import type { MockFixture } from "./fixture";

/** One handler per command of the generated `Commands`; a mock that drifts from the contract fails `tsc`. */
export type MockHandlers = {
  [K in CommandName]: (args: Commands[K]["args"]) => Commands[K]["result"];
};

interface MockInternals {
  invoke(cmd: string, args?: unknown): Promise<unknown>;
  transformCallback(callback?: (response: unknown) => void, once?: boolean): number;
  unregisterCallback(id: number): void;
  convertFileSrc(path: string, protocol?: string): string;
  metadata: {
    currentWindow: { label: string };
    currentWebview: { windowLabel: string; label: string };
  };
  mockCore: true;
}

/**
 * Installs the mocked core in place of Tauri IPC: `window.__TAURI_INTERNALS__`, which
 * `@tauri-apps/api` calls. Playwright passes this function to `page.addInitScript`, which
 * serialises it, so it must stay self-contained: no references to imported values.
 */
export function installMockCore(fixture: MockFixture): void {
  const callbacks = new Map<number, (response: unknown) => void>();
  // Running mocked gloss streams: id → stop.
  const streams = new Map<string, () => void>();
  let glossCount = 0;
  // The course rail as the core keeps it, and the `course:changed` listeners: event id → callback id.
  let rail = fixture.rail.map((c) => ({ ...c }));
  const switchable = { ...fixture.switch };
  let layout = { ...fixture.layout };
  delete (window as unknown as { __mockLayout?: unknown }).__mockLayout;
  const listeners = new Map<number, number>();
  // Each install starts a fresh record of switches.
  delete (window as unknown as { __mockSwitches?: string[] }).__mockSwitches;
  let nextEventId = 1;
  const emitRail = () => {
    for (const [id, handler] of listeners) {
      callbacks.get(handler)?.({ event: "course:changed", id, payload: { courses: rail.map((c) => ({ ...c })) } });
    }
  };
  const fail = (code: IpcError["code"], message: string): never => {
    const error: IpcError = { code, message, retryable: false };
    throw error;
  };
  const handlers: MockHandlers = {
    app_info: () => fixture.appInfo,
    // The layout the app starts with; each save is kept for the test to read back
    // (window.__mockLayout), and is what the next app_layout_get answers.
    app_layout_get: () => ({ ...layout }),
    app_layout_save: ({ layout: saved }) => {
      const w = window as unknown as { __mockLayout?: { sidebar: boolean }[] };
      w.__mockLayout ??= [];
      w.__mockLayout.push({ ...saved });
      layout = { ...saved };
      return null;
    },
    // keymaps.jsonc as the fixture has it; `{ error }` is a file the core refuses (D-199).
    keymaps_read: () => {
      const k = fixture.keymaps;
      if (k !== null && typeof k === "object") return fail("E_INVALID_ARGUMENT", k.error);
      return k;
    },
    // Records each paint, with its time, for the test to read back (window.__mockStartup).
    app_mark_startup: ({ paint }) => {
      const w = window as unknown as { __mockStartup?: { paint: string; at: number }[] };
      w.__mockStartup ??= [];
      w.__mockStartup.push({ paint, at: performance.now() });
      return undefined;
    },
    // The picked course joins the rail (once) and can be switched to from then on.
    course_open: () => {
      const opened = fixture.courseOpen;
      if (opened && !rail.some((c) => c.path === opened.path)) {
        const icon = opened.name.charAt(0).toUpperCase() || "C";
        rail.push({ path: opened.path, name: opened.name, icon, color: "#3584e4", missing: false });
        switchable[opened.path] ??= opened;
        setTimeout(emitRail, 0);
      }
      return opened;
    },
    course_list: () => rail.map((c) => ({ ...c })),
    // Any order of the rail's paths, each once; the event follows, as from the core.
    course_reorder: ({ order }) => {
      const have = rail.map((c) => c.path).sort();
      const want = [...order].sort();
      if (have.length !== want.length || have.some((p, i) => p !== want[i])) {
        fail("E_INVALID_ARGUMENT", "The new order must list each course on the rail exactly once.");
      }
      rail = order.map((p) => rail.find((c) => c.path === p)).filter((c) => c !== undefined);
      setTimeout(emitRail, 0);
      return rail.map((c) => ({ ...c }));
    },
    // Each call is kept for the test to read back (window.__mockSwitches).
    course_switch: ({ course }) => {
      const w = window as unknown as { __mockSwitches?: string[] };
      w.__mockSwitches ??= [];
      w.__mockSwitches.push(course);
      if (!rail.some((c) => c.path === course))
        fail("E_INVALID_ARGUMENT", "That course isn't on the rail; add its folder with +.");
      const opened = switchable[course];
      if (!opened) return fail("E_NOT_FOUND", "That course folder is missing or has moved; add it again with +.");
      return opened;
    },
    // The course's trust becomes the answer, with its screen; each call is kept for the test to
    // read back (window.__mockTrust). Only a course course_open or course_switch returned can be
    // answered.
    course_trust: (args) => {
      const w = window as unknown as { __mockTrust?: (typeof args)[] };
      w.__mockTrust ??= [];
      w.__mockTrust.push(args);
      const opened = fixture.courseOpen?.path === args.course ? fixture.courseOpen : switchable[args.course];
      if (!opened) {
        const error: IpcError = {
          code: "E_INVALID_ARGUMENT",
          message: "Open the course before its lectures.",
          retryable: false,
        };
        throw error;
      }
      const details = args.choice === "trusted" ? fixture.details : null;
      return { trust: args.choice, screen: { ...opened.screen, changed: false }, details };
    },
    // Records each save for the test to read back (window.__mockDetails) and answers with it.
    course_details_save: (args) => {
      const w = window as unknown as { __mockDetails?: (typeof args)[] };
      w.__mockDetails ??= [];
      w.__mockDetails.push(args);
      return args.details;
    },
    lecture_open: ({ path }) => {
      const lecture = fixture.lectures[path];
      if (lecture) return lecture;
      const error: IpcError = { code: "E_NOT_FOUND", message: `${path} no longer exists.`, retryable: false };
      throw error;
    },
    // Records each batch for the test to read back (window.__mockEdits); edits are not applied.
    lecture_apply_edits: (args) => {
      const w = window as unknown as { __mockEdits?: (typeof args)[] };
      w.__mockEdits ??= [];
      w.__mockEdits.push(args);
      return null;
    },
    // Records each call for the test to read back (window.__mockFinds).
    search_find: (args) => {
      const w = window as unknown as { __mockFinds?: (typeof args)[] };
      w.__mockFinds ??= [];
      w.__mockFinds.push(args);
      return fixture.find[args.query] ?? [];
    },
    // Plays fixture.gloss on the channel as the core would (03-lecture-files.md#body for the div).
    gloss_request: ({ block, question, onEvent }) => {
      glossCount += 1;
      const gloss = `g-${glossCount.toString(16).padStart(4, "0")}`;
      let index = 0;
      const send = (message: unknown) => callbacks.get(onEvent.id)?.({ index: index++, message });
      const div = (answer: string) =>
        `::: {.gloss #${gloss} kind=ask key=a anchor=${block} model="sample" by=ai}\n**you asked:** ${question.trim()}\n${answer ? `\n${answer.trimEnd()}\n` : ""}:::`;
      let text = "";
      let next = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const step = () => {
        const delta = fixture.gloss.deltas[next];
        if (delta === undefined) {
          streams.delete(gloss);
          send({ event: "done", data: { markdown: div(text) } });
          return;
        }
        next += 1;
        text += delta;
        send({ event: "delta", data: { text: delta } });
        timer = setTimeout(step, fixture.gloss.deltaMs);
      };
      streams.set(gloss, () => {
        clearTimeout(timer);
        streams.delete(gloss);
        send({ event: "stopped", data: { markdown: text.trim() ? div(text) : null } });
      });
      setTimeout(() => {
        send({ event: "started", data: { gloss, model: "sample" } });
        step();
      }, 0);
      return gloss;
    },
    gloss_cancel: ({ gloss }) => {
      streams.get(gloss)?.();
      return null;
    },
  };
  const isCommand = (cmd: string): cmd is CommandName => Object.hasOwn(handlers, cmd);
  let nextId = 1;
  const internals: MockInternals = {
    invoke(cmd, args) {
      // Tauri's event plugin, for `course:changed` (the only event the core sends).
      if (cmd === "plugin:event|listen") {
        const { event, handler } = args as { event: string; handler: number };
        const id = nextEventId++;
        if (event === "course:changed") listeners.set(id, handler);
        return Promise.resolve(id);
      }
      if (cmd === "plugin:event|unlisten") {
        listeners.delete((args as { eventId: number }).eventId);
        return Promise.resolve(null);
      }
      if (!isCommand(cmd)) {
        const error: IpcError = {
          code: "E_INVALID_ARGUMENT",
          message: `Unknown command ${cmd}`,
          retryable: false,
        };
        return Promise.reject(error);
      }
      // A handler throws the contract's IpcError for a failing command; the caller sees a rejection.
      try {
        // Each handler takes its own command's args; `isCommand` can't narrow which one `cmd` is.
        const handler = handlers[cmd] as (a: unknown) => unknown;
        return Promise.resolve(handler(args ?? {}));
      } catch (error) {
        return Promise.reject(error);
      }
    },
    transformCallback(callback, once) {
      const id = nextId++;
      callbacks.set(id, (response) => {
        if (once) callbacks.delete(id);
        callback?.(response);
      });
      return id;
    },
    unregisterCallback(id) {
      callbacks.delete(id);
    },
    convertFileSrc(path, protocol = "asset") {
      return `${protocol}://localhost/${encodeURIComponent(path)}`;
    },
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
    mockCore: true,
  };
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: internals,
    configurable: true,
  });
  // `@tauri-apps/api/event` drops its own record of a listener here before it unlistens.
  Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
    value: { unregisterListener: () => {} },
    configurable: true,
  });
}
