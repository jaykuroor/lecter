// A fake of the core's settings commands for the Settings window's tests: the real committed
// schema, a value in force for every setting (the given ones, else a plain one of its type), the
// global-only keys as SEC-25 groups them, and a record of every call. A write keeps the value at the
// scope's level; a course write of a global-only key is refused as the core refuses it (the core's
// own checks are tested in Rust).
import type { IpcError, Setting, SettingScope, SettingSource, SettingState } from "../../../core/bindings";
import { SCHEMA_TEXT } from "../../cmdline/__tests__/schemaText";
import { readSchema, type SettingSpec } from "../../cmdline/schema";
import type { SettingsCourse, SettingsDeps } from "../state";

type Answer<T> = { status: "ok"; data: T } | { status: "error"; error: IpcError };

export interface FakeSettingsCore extends SettingsDeps {
  calls: string[];
  held: Record<string, SettingState>;
  /** The course `course()` answers. */
  open: SettingsCourse | null;
  /** Makes the next schema ask fail. */
  failSchema: boolean;
  /** Makes the next write fail with this error. */
  failSet: IpcError | null;
}

const plain = (spec: SettingSpec): string => {
  if (spec.kind === "choice") return JSON.stringify(spec.choices[0]);
  if (spec.kind === "boolean") return "false";
  if (spec.kind === "integer" || spec.kind === "number") return "0";
  if (spec.kind === "list") return "[]";
  return "null";
};

const globalOnly = (key: string) => /^(privacy|log|limits)\./.test(key) || key === "feedback.endpoint";

export function fakeSettingsCore(
  values: Record<string, { value: string; source: SettingSource }> = {},
  themes: string[] = ["Adwaita", "Nord"],
): FakeSettingsCore {
  const held: Record<string, SettingState> = {};
  for (const spec of readSchema(SCHEMA_TEXT)) {
    const given = values[spec.key];
    held[spec.key] = {
      key: spec.key,
      value: given?.value ?? plain(spec),
      source: given?.source ?? "default",
      globalOnly: globalOnly(spec.key),
    };
  }
  const ok = <T>(data: T): Promise<Answer<T>> => Promise.resolve({ status: "ok", data });
  const fail = <T>(error: IpcError): Promise<Answer<T>> => Promise.resolve({ status: "error", error });
  const core: FakeSettingsCore = {
    calls: [],
    held,
    open: null,
    failSchema: false,
    failSet: null,
    course: () => core.open,
    schema() {
      core.calls.push("schema");
      if (core.failSchema) {
        core.failSchema = false;
        return fail({ code: "E_IO", message: "no", retryable: true });
      }
      return ok(SCHEMA_TEXT);
    },
    values(course) {
      core.calls.push(`values ${course}`);
      return ok(Object.values(held).map((s) => ({ ...s })));
    },
    set(key, json, course, scope: SettingScope) {
      core.calls.push(`set ${key}=${json} ${course} ${scope}`);
      if (core.failSet) {
        const error = core.failSet;
        core.failSet = null;
        return fail(error);
      }
      const found = held[key];
      if (!found) return fail({ code: "E_INVALID_ARGUMENT", message: `${key} is not a setting`, retryable: false });
      if (scope === "course" && found.globalOnly) {
        const message = `${key} can only be set in the global settings`;
        return fail({ code: "E_INVALID_ARGUMENT", message, retryable: false });
      }
      held[key] = { ...found, value: json, source: scope };
      const setting: Setting = { key, value: json, source: scope };
      return ok(setting);
    },
    themes() {
      core.calls.push("themes");
      return ok(themes);
    },
  };
  return core;
}
