import type { CommandName, Commands, IpcError } from "../../src/core/commands";
import type { MockFixture } from "./fixture";

/** One handler per command; a mock that drifts from `Commands` fails `tsc`. */
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
  const handlers: MockHandlers = {
    app_info: () => fixture.appInfo,
  };
  const isCommand = (cmd: string): cmd is CommandName => Object.hasOwn(handlers, cmd);
  const callbacks = new Map<number, (response: unknown) => void>();
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
      return Promise.resolve(handlers[cmd]((args ?? {}) as Commands[typeof cmd]["args"]));
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
