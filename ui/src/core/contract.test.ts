// The mocked core is checked against the generated contract (18-contracts.md#ipc): each
// `@ts-expect-error` below is a drifted mock that `tsc` must reject. If one stops being an error,
// tsc fails on the unused directive, so these cases are enforced by the type check itself.
import { describe, expect, it } from "vitest";
import type { MockHandlers } from "../../e2e/mock-core/install";
import type { CommandName, Commands, IpcError, TrustScreen } from "./bindings";

const screen: TrustScreen = {
  lectures: 0,
  slides: 0,
  sources: 0,
  provider: "sample",
  webSearch: false,
  agents: [],
  roles: [],
  skills: [],
  overrides: [],
  changed: false,
  blocked: null,
};

const matching: MockHandlers = {
  app_info: () => ({ name: "Lecter", version: "0.0.1" }),
  course_open: () => ({ path: "/courses/Algebra", name: "Algebra", lectures: [], slides: [], trust: "ask", screen }),
  lecture_open: ({ path }) => ({ path, name: "l07.md", text: "" }),
  lecture_apply_edits: () => null,
  search_find: () => [],
  gloss_request: () => "g-0001",
  gloss_cancel: () => null,
  app_mark_startup: () => undefined,
  course_trust: ({ choice }) => ({ trust: choice, screen }),
};

// @ts-expect-error a mock without a handler for a contract command (course_open)
const missing: MockHandlers = {
  app_info: () => ({ name: "Lecter", version: "0.0.1" }),
  lecture_open: ({ path }) => ({ path, name: "l07.md", text: "" }),
};

const wrongResult: MockHandlers = {
  // @ts-expect-error a handler whose result has the wrong shape
  app_info: () => ({ name: "Lecter", version: 1 }),
  course_open: () => null,
  lecture_open: ({ path }) => ({ path, name: "l07.md", text: "" }),
  lecture_apply_edits: () => null,
  search_find: () => [],
  gloss_request: () => "g-0001",
  gloss_cancel: () => null,
  app_mark_startup: () => undefined,
  course_trust: ({ choice }) => ({ trust: choice, screen }),
};

const wrongEnum: MockHandlers = {
  app_info: () => ({ name: "Lecter", version: "0.0.1" }),
  // @ts-expect-error a trust value the contract doesn't have
  course_open: () => ({ path: "/c", name: "c", lectures: [], slides: [], trust: "maybe", screen }),
  lecture_open: ({ path }) => ({ path, name: "l07.md", text: "" }),
  lecture_apply_edits: () => null,
  search_find: () => [],
  gloss_request: () => "g-0001",
  gloss_cancel: () => null,
  app_mark_startup: () => undefined,
  course_trust: ({ choice }) => ({ trust: choice, screen }),
};

const extra: MockHandlers = {
  app_info: () => ({ name: "Lecter", version: "0.0.1" }),
  course_open: () => null,
  lecture_open: ({ path }) => ({ path, name: "l07.md", text: "" }),
  lecture_apply_edits: () => null,
  search_find: () => [],
  gloss_request: () => "g-0001",
  gloss_cancel: () => null,
  app_mark_startup: () => undefined,
  course_trust: ({ choice }) => ({ trust: choice, screen }),
  // @ts-expect-error a command the contract doesn't have
  course_delete: () => null,
};

// @ts-expect-error an error code outside 18-contracts.md#error-codes
const badCode: IpcError = { code: "E_NOPE", message: "x", retryable: false };

const commandNames: CommandName[] = [
  "gloss_request",
  "gloss_cancel",
  "app_info",
  "app_mark_startup",
  "course_open",
  "course_trust",
  "lecture_open",
  "lecture_apply_edits",
  "search_find",
];
const noArgs: Commands["course_open"]["args"] = {};

describe("the generated contract", () => {
  it("types the mocked core's handlers by command name", () => {
    expect(Object.keys(matching).sort()).toEqual([...commandNames].sort());
    expect(matching.course_open(noArgs)).toMatchObject({ trust: "ask" });
    expect([missing, wrongResult, wrongEnum, extra, badCode]).toHaveLength(5);
  });
});
