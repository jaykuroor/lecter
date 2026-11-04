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
  const handlers: MockHandlers = {
    app_info: () => fixture.appInfo,
    // Records each paint, with its time, for the test to read back (window.__mockStartup).
    app_mark_startup: ({ paint }) => {
      const w = window as unknown as { __mockStartup?: { paint: string; at: number }[] };
      w.__mockStartup ??= [];
      w.__mockStartup.push({ paint, at: performance.now() });
      return undefined;
    },
    course_open: () => fixture.courseOpen,
    // The course's trust becomes the answer, with its screen; each call is kept for the test to
    // read back (window.__mockTrust). Only the course course_open returned can be answered.
    course_trust: (args) => {
      const w = window as unknown as { __mockTrust?: (typeof args)[] };
      w.__mockTrust ??= [];
      w.__mockTrust.push(args);
      const opened = fixture.courseOpen;
      if (!opened || opened.path !== args.course) {
        const error: IpcError = {
          code: "E_INVALID_ARGUMENT",
          message: "Open the course before its lectures.",
          retryable: false,
        };
        throw error;
      }
      return { trust: args.choice, screen: { ...opened.screen, changed: false } };
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
}
