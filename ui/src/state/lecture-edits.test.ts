// F-021: the buffer's edits go to the core in order, one batch at a time, without the key path
// waiting for an answer.
import { describe, expect, it } from "vitest";
import { defaultFixture } from "../../e2e/mock-core/fixture";
import { installMockCore } from "../../e2e/mock-core/install";
import type { Edit } from "../core/lecture";
import { createLecture } from "./lecture";

const l07 = { path: "lectures/l07.md", name: "l07.md", text: "[A]{#s1b1}\n" };
const l08 = { path: "lectures/l08.md", name: "l08.md", text: "[B]{#s1b1}\n" };

interface Args {
  course?: string;
  path?: string;
  edits?: Edit[];
}
type Invoke = (cmd: string, args?: Args) => Promise<unknown>;
const internals = () => (window as unknown as { __TAURI_INTERNALS__: { invoke: Invoke } }).__TAURI_INTERNALS__;

/** Holds `lecture_apply_edits` calls until the test answers them; other commands go to the mock. */
function holdEdits() {
  const calls: { args: Args; answer: (v: unknown) => void; fail: (e: unknown) => void }[] = [];
  const real = internals().invoke;
  internals().invoke = (cmd, args) => {
    if (cmd !== "lecture_apply_edits") return real(cmd, args);
    return new Promise((answer, fail) => calls.push({ args: args ?? {}, answer, fail }));
  };
  return calls;
}

const typed = (at: number, text: string): Edit[] => [{ from: at, to: at, text }];
/** Lets answered calls and the next send run. */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("sending the buffer's edits", () => {
  it("sends nothing before a lecture is open", async () => {
    installMockCore(defaultFixture);
    const calls = holdEdits();
    const state = createLecture();
    state.edit(typed(0, "x"));
    await state.settled();
    expect(calls).toHaveLength(0);
  });

  it("sends at once, then one batch at a time with everything typed meanwhile, in order", async () => {
    installMockCore({ ...defaultFixture, lectures: { [l07.path]: l07 } });
    const calls = holdEdits();
    const state = createLecture();
    await state.open("/c/STAT311", l07.path);
    state.edit(typed(1, "a"));
    expect(calls.map((c) => c.args)).toEqual([{ course: "/c/STAT311", path: l07.path, edits: typed(1, "a") }]);
    state.edit(typed(2, "b"));
    state.edit([...typed(3, "c"), { from: 0, to: 1, text: "" }]);
    expect(calls).toHaveLength(1);
    calls[0]?.answer(null);
    await tick();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args.edits).toEqual([...typed(2, "b"), ...typed(3, "c"), { from: 0, to: 1, text: "" }]);
    calls[1]?.answer(null);
    await state.settled();
    expect(calls).toHaveLength(2);
    expect(state.error()).toBeNull();
  });

  it("splits a batch at the core's limits", async () => {
    installMockCore({ ...defaultFixture, lectures: { [l07.path]: l07 } });
    const calls = holdEdits();
    const state = createLecture();
    await state.open("/c", l07.path);
    state.edit(typed(0, "first"));
    // 1,500 edits wait behind the first call: the next batch takes 1,000 of them.
    state.edit(Array.from({ length: 1_500 }, (_, i) => ({ from: i, to: i, text: "x" })));
    calls[0]?.answer(null);
    await tick();
    expect(calls[1]?.args.edits).toHaveLength(1_000);
    calls[1]?.answer(null);
    await tick();
    expect(calls[2]?.args.edits).toHaveLength(500);
    expect(calls[2]?.args.edits?.[0]).toEqual({ from: 1_000, to: 1_000, text: "x" });
    calls[2]?.answer(null);
    await tick();
    // Big texts: two 100,000-unit inserts don't share a batch (131,072 units at most).
    const big = "y".repeat(100_000);
    state.edit([...typed(0, big), ...typed(0, big)]);
    calls[3]?.answer(null);
    await tick();
    expect(calls.slice(3).map((c) => c.args.edits?.length)).toEqual([1, 1]);
    calls[4]?.answer(null);
    await state.settled();
  });

  it("sends each edit to the lecture it was made in", async () => {
    installMockCore({ ...defaultFixture, lectures: { [l07.path]: l07, [l08.path]: l08 } });
    const calls = holdEdits();
    const state = createLecture();
    await state.open("/c", l07.path);
    state.edit(typed(0, "seven"));
    await state.open("/c", l08.path);
    state.edit(typed(0, "eight"));
    calls[0]?.answer(null);
    await tick();
    expect(calls.map((c) => [c.args.path, c.args.edits])).toEqual([
      [l07.path, typed(0, "seven")],
      [l08.path, typed(0, "eight")],
    ]);
    calls[1]?.answer(null);
    await state.settled();
  });

  it("shows the core's message when it refuses an edit, and keeps sending", async () => {
    installMockCore({ ...defaultFixture, lectures: { [l07.path]: l07 } });
    const calls = holdEdits();
    const state = createLecture();
    await state.open("/c", l07.path);
    state.edit(typed(99, "x"));
    calls[0]?.fail({
      code: "E_INVALID_ARGUMENT",
      message: "lectures/l07.md changed in a way Lecter could not follow; reopen it.",
      retryable: false,
    });
    await state.settled();
    expect(state.error()).toBe("lectures/l07.md changed in a way Lecter could not follow; reopen it.");
    state.edit(typed(0, "y"));
    expect(calls).toHaveLength(2);
    calls[1]?.fail(new Error("IPC closed"));
    await state.settled();
    expect(state.error()).toBe("Lecter could not reach the core to save your edit.");
  });
});
