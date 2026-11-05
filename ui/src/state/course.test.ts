import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultFixture, trustScreen } from "../../e2e/mock-core/fixture";
import { installMockCore } from "../../e2e/mock-core/install";
import type { CourseDetails, CourseOpened } from "../core/bindings";
import { type CourseState, createCourse } from "./course";

const algebra: CourseOpened = {
  path: "/courses/Algebra",
  name: "Algebra",
  lectures: [{ name: "l01.md", path: "lectures/l01.md" }],
  slides: [],
  trust: "ask",
  screen: trustScreen,
};

const details: CourseDetails = {
  name: "Algebra",
  code: "",
  term: "",
  professor: "",
  icon: "A",
  color: "#3584e4",
  folders: { slides: "slides", sources: "sources", lectures: "lectures", pastPapers: "sources/past-papers" },
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

  // F-034: Trust brings the details form with the core's first values; Save sends them to
  // `course_details_save` for the open course and closes the form once the core wrote them.
  it("shows the details form after Trust and closes it once saved", async () => {
    const sent: unknown[] = [];
    const answers: unknown[] = [algebra, { trust: "trusted", screen: trustScreen, details }, details];
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: Invoke } };
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      sent.push([cmd, args]);
      return Promise.resolve(answers.shift());
    };
    const s = state();
    await s.saveDetails(details);
    expect(sent).toEqual([]);
    await s.open();
    expect(s.details()).toBeNull();
    await s.answer("trusted");
    expect(s.details()).toEqual(details);
    const mine = { ...details, professor: "Dr. Rivera" };
    await s.saveDetails(mine);
    expect(sent[2]).toEqual(["course_details_save", { course: "/courses/Algebra", details: mine }]);
    expect(s.details()).toBeNull();
    expect(s.detailsError()).toBeNull();
    expect(s.busy()).toBe(false);
    // With the form closed, nothing more is saved.
    await s.saveDetails(mine);
    expect(sent).toHaveLength(3);
  });

  // A read-only course never gets the form, even if an answer carried values.
  it("never shows the form for a read-only course", async () => {
    scriptCore([algebra, { trust: "read_only", screen: trustScreen, details }]);
    const s = state();
    await s.open();
    await s.answer("read_only");
    expect(s.details()).toBeNull();
  });

  // A failed save keeps the form open with the core's reason; Later closes it without a save.
  it("keeps the form open with the reason when a save fails, and Later closes it", async () => {
    const calls = scriptCore([
      algebra,
      { trust: "trusted", screen: trustScreen, details },
      { code: "E_INVALID_ARGUMENT", message: "Give the course a name.", retryable: false },
      new Error("IPC bridge gone"),
    ]);
    const s = state();
    await s.open();
    await s.answer("trusted");
    await s.saveDetails({ ...details, name: "" });
    expect(s.details()).toEqual(details);
    expect(s.detailsError()).toBe("Give the course a name.");
    await s.saveDetails(details);
    expect(s.detailsError()).toBe("Lecter could not reach the core to save the course details.");
    expect(s.busy()).toBe(false);
    s.skipDetails();
    expect(s.details()).toBeNull();
    expect(s.detailsError()).toBeNull();
    expect(calls()).toBe(4);
  });

  // One save at a time: it holds `busy` until the core replies, and a second Save meanwhile is
  // not sent.
  it("saves the details once at a time", async () => {
    let reply: (v: unknown) => void = () => {};
    const sent: string[] = [];
    const answers: unknown[] = [algebra, { trust: "trusted", screen: trustScreen, details }];
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: Invoke } };
    w.__TAURI_INTERNALS__.invoke = (cmd) => {
      sent.push(cmd);
      const a = answers.shift();
      return a === undefined ? new Promise((resolve) => (reply = resolve)) : Promise.resolve(a);
    };
    const s = state();
    await s.open();
    await s.answer("trusted");
    const first = s.saveDetails(details);
    expect(s.busy()).toBe(true);
    await s.saveDetails(details);
    expect(sent).toEqual(["course_open", "course_trust", "course_details_save"]);
    reply(details);
    await first;
    expect(s.busy()).toBe(false);
    expect(s.details()).toBeNull();
  });

  // Opening another course closes the first one's form.
  it("closes the form when another course opens", async () => {
    scriptCore([algebra, { trust: "trusted", screen: trustScreen, details }, { ...algebra, path: "/courses/Calc" }]);
    const s = state();
    await s.open();
    await s.answer("trusted");
    expect(s.details()).toEqual(details);
    await s.open();
    expect(s.details()).toBeNull();
  });
});

// F-035: a course on the rail opens without the dialog, through the core's checks.
describe("switching to a course on the rail", () => {
  const calc: CourseOpened = { ...algebra, path: "/courses/Calc", name: "Calc", trust: "read_only" };
  const railOf = (...courses: CourseOpened[]) =>
    courses.map((c) => ({ path: c.path, name: c.name, icon: "A", color: "#3584e4", missing: false }));

  it("opens the course the core sends, as an open does, and asks for nothing", async () => {
    installMockCore({
      ...defaultFixture,
      rail: railOf(algebra, calc),
      switch: { [algebra.path]: algebra, [calc.path]: calc },
    });
    const s = state();
    await s.switchTo(calc.path);
    expect(s.course()).toEqual(calc);
    await s.switchTo(algebra.path);
    expect(s.course()).toEqual(algebra);
    expect((window as unknown as { __mockSwitches: string[] }).__mockSwitches).toEqual([calc.path, algebra.path]);
  });

  it("does nothing for the course already open", async () => {
    installMockCore({ ...defaultFixture, rail: railOf(algebra), switch: { [algebra.path]: algebra } });
    const s = state();
    await s.switchTo(algebra.path);
    await s.switchTo(algebra.path);
    expect((window as unknown as { __mockSwitches: string[] }).__mockSwitches).toEqual([algebra.path]);
  });

  it("keeps the open course and shows why when the folder is missing", async () => {
    installMockCore({ ...defaultFixture, rail: railOf(algebra, calc), switch: { [algebra.path]: algebra } });
    const s = state();
    await s.switchTo(algebra.path);
    await s.switchTo(calc.path);
    expect(s.course()).toEqual(algebra);
    expect(s.error()).toBe("That course folder is missing or has moved; add it again with +.");
    expect(s.busy()).toBe(false);
  });

  it("says so when the core can't be reached", async () => {
    scriptCore([new Error("gone")]);
    const s = state();
    await s.switchTo("/courses/Calc");
    expect(s.course()).toBeNull();
    expect(s.error()).toBe("Lecter could not reach the core to open that course.");
  });

  it("closes another course's details form", async () => {
    scriptCore([algebra, { trust: "trusted", screen: trustScreen, details }, calc]);
    const s = state();
    await s.open();
    await s.answer("trusted");
    await s.switchTo(calc.path);
    expect(s.details()).toBeNull();
    expect(s.course()).toEqual(calc);
  });
});
