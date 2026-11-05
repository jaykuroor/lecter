// A fake of the core's settings commands for the command line's tests: the real committed schema,
// values held in memory with their level, and a record of every call. Writes are taken as sent
// (the command line checks them against the schema first; the core's own check is tested in Rust).
import type { IpcError, Setting, SettingSource } from "../../../core/bindings";
import type { CmdlineDeps } from "../state";
import { SCHEMA_TEXT } from "./schemaText";

type Answer<T> = { status: "ok"; data: T } | { status: "error"; error: IpcError };

export interface FakeCore extends CmdlineDeps {
  calls: string[];
  /** Makes the next schema ask fail. */
  failSchema: boolean;
  /** Makes the next write fail with this error. */
  failSet: IpcError | null;
}

export function fakeCore(values: Record<string, { value: string; source: SettingSource }> = {}): FakeCore {
  const held = { ...values };
  const core: FakeCore = {
    calls: [],
    failSchema: false,
    failSet: null,
    course: () => "/courses/STAT311",
    schema(): Promise<Answer<string>> {
      core.calls.push("schema");
      if (core.failSchema) {
        core.failSchema = false;
        return Promise.resolve({ status: "error", error: { code: "E_IO", message: "no", retryable: true } });
      }
      return Promise.resolve({ status: "ok", data: SCHEMA_TEXT });
    },
    get(key, course): Promise<Answer<Setting>> {
      core.calls.push(`get ${key} ${course}`);
      const found = held[key];
      if (!found) {
        return Promise.resolve({
          status: "error",
          error: { code: "E_NOT_FOUND", message: `${key} is not a setting`, retryable: false },
        });
      }
      return Promise.resolve({ status: "ok", data: { key, ...found } });
    },
    set(key, json, course): Promise<Answer<Setting>> {
      core.calls.push(`set ${key} ${json} ${course}`);
      if (core.failSet) {
        const error = core.failSet;
        core.failSet = null;
        return Promise.resolve({ status: "error", error });
      }
      held[key] = { value: json, source: "global" };
      return Promise.resolve({ status: "ok", data: { key, value: json, source: "global" } });
    },
  };
  return core;
}

/** Lets the fake core's answers (resolved promises) arrive. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
