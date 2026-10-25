import { describe, expect, it } from "vitest";
import { defaultFixture } from "../../e2e/mock-core/fixture";
import { installMockCore } from "../../e2e/mock-core/install";
import { createLecture } from "./lecture";

const l07 = { path: "lectures/l07.md", name: "l07.md", text: "[A]{#s1b1}\n" };
const l08 = { path: "lectures/l08.md", name: "l08.md", text: "[B]{#s1b1}\n" };

type Invoke = (cmd: string, args?: { course: string; path: string }) => Promise<unknown>;
const internals = () => (window as unknown as { __TAURI_INTERNALS__: { invoke: Invoke } }).__TAURI_INTERNALS__;

describe("the open lecture", () => {
  it("asks the core for the course's lecture and holds it", async () => {
    installMockCore({ ...defaultFixture, lectures: { [l07.path]: l07 } });
    const asked: unknown[] = [];
    const real = internals().invoke;
    internals().invoke = (cmd, args) => {
      asked.push([cmd, args]);
      return real(cmd, args);
    };
    const state = createLecture();
    expect(state.lecture()).toBeNull();
    await state.open("/c/STAT311", "lectures/l07.md");
    expect(asked).toEqual([["lecture_open", { course: "/c/STAT311", path: "lectures/l07.md" }]]);
    expect(state.lecture()).toEqual(l07);
    expect(state.error()).toBeNull();
  });

  it("shows the core's message and keeps the current lecture when an open fails", async () => {
    installMockCore({ ...defaultFixture, lectures: { [l07.path]: l07 } });
    const state = createLecture();
    await state.open("/c", "lectures/l07.md");
    await state.open("/c", "lectures/gone.md");
    expect(state.error()).toBe("lectures/gone.md no longer exists.");
    expect(state.lecture()).toEqual(l07);
    await state.open("/c", "lectures/l07.md");
    expect(state.error()).toBeNull();
  });

  it("says so when the core can't be reached", async () => {
    installMockCore(defaultFixture);
    internals().invoke = () => {
      throw new Error("no IPC");
    };
    const state = createLecture();
    await state.open("/c", "lectures/l07.md");
    expect(state.error()).toBe("Lecter could not reach the core to open the lecture.");
    expect(state.lecture()).toBeNull();
  });

  it("drops an older answer that arrives after a newer one", async () => {
    installMockCore(defaultFixture);
    const answers: ((v: unknown) => void)[] = [];
    internals().invoke = () => new Promise((resolve) => answers.push(resolve));
    const state = createLecture();
    const first = state.open("/c", l07.path);
    const second = state.open("/c", l08.path);
    answers[1]?.(l08);
    await second;
    answers[0]?.(l07);
    await first;
    expect(state.lecture()).toEqual(l08);
  });

  it("drops an older failure that arrives after a newer answer", async () => {
    installMockCore(defaultFixture);
    const settle: { ok: (v: unknown) => void; fail: (e: unknown) => void }[] = [];
    internals().invoke = () => new Promise((ok, fail) => settle.push({ ok, fail }));
    const state = createLecture();
    const first = state.open("/c", l07.path);
    const second = state.open("/c", l08.path);
    settle[1]?.ok(l08);
    await second;
    settle[0]?.fail({ code: "E_NOT_FOUND", message: "lectures/l07.md no longer exists.", retryable: false });
    await first;
    expect(state.error()).toBeNull();
    expect(state.lecture()).toEqual(l08);
  });
});
