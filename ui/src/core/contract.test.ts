// The mocked core is checked against the generated contract (18-contracts.md#ipc): each
// `@ts-expect-error` below is a drifted mock that `tsc` must reject. If one stops being an error,
// tsc fails on the unused directive, so these cases are enforced by the type check itself.
import { describe, expect, it } from "vitest";
import type { MockHandlers } from "../../e2e/mock-core/install";
import type { CommandName, Commands, IpcError } from "./bindings";

const matching: MockHandlers = {
  app_info: () => ({ name: "Lecter", version: "0.0.1" }),
  course_open: () => ({ path: "/courses/Algebra", name: "Algebra", lectures: [], slides: [], trust: "ask" }),
};

// @ts-expect-error a mock without a handler for a contract command (course_open)
const missing: MockHandlers = { app_info: () => ({ name: "Lecter", version: "0.0.1" }) };

const wrongResult: MockHandlers = {
  // @ts-expect-error a handler whose result has the wrong shape
  app_info: () => ({ name: "Lecter", version: 1 }),
  course_open: () => null,
};

const wrongEnum: MockHandlers = {
  app_info: () => ({ name: "Lecter", version: "0.0.1" }),
  // @ts-expect-error a trust value the contract doesn't have
  course_open: () => ({ path: "/c", name: "c", lectures: [], slides: [], trust: "maybe" }),
};

const extra: MockHandlers = {
  app_info: () => ({ name: "Lecter", version: "0.0.1" }),
  course_open: () => null,
  // @ts-expect-error a command the contract doesn't have
  course_delete: () => null,
};

// @ts-expect-error an error code outside 18-contracts.md#error-codes
const badCode: IpcError = { code: "E_NOPE", message: "x", retryable: false };

const commandNames: CommandName[] = ["app_info", "course_open"];
const noArgs: Commands["course_open"]["args"] = {};

describe("the generated contract", () => {
  it("types the mocked core's handlers by command name", () => {
    expect(Object.keys(matching).sort()).toEqual([...commandNames].sort());
    expect(matching.course_open(noArgs)).toMatchObject({ trust: "ask" });
    expect([missing, wrongResult, wrongEnum, extra, badCode]).toHaveLength(5);
  });
});
