import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultFixture } from "../../e2e/mock-core/fixture";
import { installMockCore } from "../../e2e/mock-core/install";
import type { CourseOpened } from "../core/bindings";
import { type CourseState, createCourse } from "./course";

const algebra: CourseOpened = {
  path: "/courses/Algebra",
  name: "Algebra",
  lectures: [{ name: "l01.md", path: "lectures/l01.md" }],
  slides: [],
  trust: "ask",
};

type Invoke = (cmd: string, args?: unknown) => Promise<unknown>;

/** Answers each `course_open` with the next of `answers`: a value resolves, an `Error` or an
 *  IpcError-shaped object (`{ code }`) rejects. Returns the number of calls so far. */
function scriptCore(answers: unknown[]): () => number {
  let calls = 0;
  const w = window as unknown as { __TAURI_INTERNALS__: { invoke: Invoke } };
  w.__TAURI_INTERNALS__.invoke = () => {
    const a = answers[calls];
    calls += 1;
    const rejects = a instanceof Error || (typeof a === "object" && a !== null && "code" in a);
    return rejects ? Promise.reject(a) : Promise.resolve(a);
  };
  return () => calls;
}

function state(): CourseState {
  return createRoot(() => createCourse());
}

describe("course state", () => {
  beforeEach(() => installMockCore(defaultFixture));

  it("keeps the open course when a later dialog is cancelled", async () => {
    scriptCore([algebra, null]);
    const s = state();
    await s.open();
    await s.open();
    expect(s.course()).toEqual(algebra);
    expect(s.error()).toBeNull();
  });

  it("clears an earlier error once a course opens", async () => {
    scriptCore([
      { code: "E_NOT_TRUSTED", message: "slides/x.pdf points outside the course folder.", retryable: false },
      algebra,
    ]);
    const s = state();
    await s.open();
    expect(s.error()).toBe("slides/x.pdf points outside the course folder.");
    expect(s.course()).toBeNull();
    await s.open();
    expect(s.error()).toBeNull();
    expect(s.course()).toEqual(algebra);
  });

  it("asks the core once while a dialog is already open", async () => {
    const calls = scriptCore([algebra, algebra]);
    const s = state();
    const first = s.open();
    expect(s.busy()).toBe(true);
    await s.open();
    expect(calls()).toBe(1);
    await first;
    expect(s.busy()).toBe(false);
  });

  it("reports a broken IPC bridge without losing the open course", async () => {
    scriptCore([algebra, new Error("IPC bridge gone")]);
    const s = state();
    await s.open();
    await s.open();
    expect(s.error()).toBe("Lecter could not reach the core to open the folder.");
    expect(s.course()).toEqual(algebra);
    expect(s.busy()).toBe(false);
  });
});
