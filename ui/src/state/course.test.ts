import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultFixture, trustScreen } from "../../e2e/mock-core/fixture";
import { installMockCore } from "../../e2e/mock-core/install";
import type { CourseOpened } from "../core/bindings";
import { type CourseState, createCourse } from "./course";

const algebra: CourseOpened = {
  path: "/courses/Algebra",
  name: "Algebra",
  lectures: [{ name: "l01.md", path: "lectures/l01.md" }],
  slides: [],
  trust: "ask",
  screen: trustScreen,
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

  // F-033: the answer goes to `course_trust` for the open course; the core's state and screen
  // replace the course's, including when it asks again because the AI files changed.
  it("answers the trust screen and takes the core's state and screen", async () => {
    const changed = { ...trustScreen, changed: true, agents: ["AGENTS.md"] };
    const sent: unknown[] = [];
    const answers: unknown[] = [
      algebra,
      { trust: "ask", screen: changed },
      { trust: "read_only", screen: trustScreen },
    ];
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: Invoke } };
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      sent.push([cmd, args]);
      return Promise.resolve(answers.shift());
    };
    const s = state();
    await s.answer("trusted");
    expect(sent).toEqual([]);
    expect(s.error()).toBeNull();
    await s.open();
    await s.answer("trusted");
    expect(sent[1]).toEqual(["course_trust", { course: "/courses/Algebra", choice: "trusted" }]);
    expect(s.course()).toEqual({ ...algebra, trust: "ask", screen: changed });
    await s.answer("read_only");
    expect(s.course()).toEqual({ ...algebra, trust: "read_only", screen: trustScreen });
    expect(s.busy()).toBe(false);
  });

  it("keeps the question open when the answer can't be saved", async () => {
    scriptCore([
      algebra,
      { code: "E_IO", message: "Lecter could not save your answer for this folder.", retryable: true },
      new Error("IPC bridge gone"),
    ]);
    const s = state();
    await s.open();
    await s.answer("trusted");
    expect(s.error()).toBe("Lecter could not save your answer for this folder.");
    expect(s.course()?.trust).toBe("ask");
    await s.answer("trusted");
    expect(s.error()).toBe("Lecter could not reach the core to save your answer.");
    expect(s.course()?.trust).toBe("ask");
    expect(s.busy()).toBe(false);
  });

  // One call at a time: no answer while the dialog is open, and the answer holds `busy` until the
  // core replies; a saved answer clears the error of one that couldn't be saved.
  it("answers once at a time and clears an earlier error", async () => {
    let reply: (v: unknown) => void = () => {};
    const sent: string[] = [];
    const answers: unknown[] = [
      algebra,
      { code: "E_IO", message: "Lecter could not save your answer for this folder.", retryable: true },
    ];
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: Invoke } };
    w.__TAURI_INTERNALS__.invoke = (cmd) => {
      sent.push(cmd);
      const a = answers.shift();
      if (a === undefined) return new Promise((resolve) => (reply = resolve));
      return "code" in (a as object) ? Promise.reject(a) : Promise.resolve(a);
    };
    const s = state();
    await s.open();
    await s.answer("trusted");
    expect(s.error()).toBe("Lecter could not save your answer for this folder.");
    const pending = s.answer("read_only");
    expect(s.busy()).toBe(true);
    await s.answer("trusted");
    await s.open();
    expect(sent).toEqual(["course_open", "course_trust", "course_trust"]);
    reply({ trust: "read_only", screen: trustScreen });
    await pending;
    expect(s.busy()).toBe(false);
    expect(s.error()).toBeNull();
    expect(s.course()?.trust).toBe("read_only");
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
