import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import type { Setting } from "../../core/bindings";
import { type FollowDeps, followSetting } from "./follow";

/**
 * A fake core: each read waits for the test's `answer`, in the order it gives (else as they were
 * asked), with the value `values` holds for its course; events go to the listener.
 */
function fakeCore(values: Record<string, string>) {
  const pending: (() => void)[] = [];
  const asked: string[] = [];
  const written: string[] = [];
  let listener: ((s: Setting) => void) | null = null;
  let unlistened = 0;
  const deps: FollowDeps = {
    get: (key, course) => {
      asked.push(`${key} ${course}`);
      return new Promise((resolve) => {
        const value = values[`${key} ${course}`] ?? values[key] ?? "null";
        pending.push(() => resolve({ status: "ok", data: { key, value, source: "global" } }));
      });
    },
    listen: (l) => {
      listener = l;
      return Promise.resolve(() => {
        unlistened += 1;
        listener = null;
      });
    },
    set: (key, json, course) => {
      written.push(`${key}=${json} ${course}`);
      return Promise.resolve({ status: "ok", data: { key, value: json, source: "global" } });
    },
  };
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  /** Answers the reads asked so far, in the order given (default: as asked). */
  const answer = async (order?: number[]) => {
    const all = pending.splice(0);
    for (const i of order ?? all.map((_, n) => n)) all[i]?.();
    await flush();
  };
  const emit = (s: Setting) => listener?.(s);
  return { deps, asked, written, answer, emit, unlistened: () => unlistened };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("followSetting (F-045 criterion 2: a change applies at once)", () => {
  it("applies the value in force, then each change of its key", async () => {
    const core = fakeCore({ "ui.hintBar": '"compact"' });
    const got: string[] = [];
    const f = followSetting(
      core.deps,
      "ui.hintBar",
      () => null,
      (v) => got.push(v),
    );
    await core.answer();
    expect(core.asked).toEqual(["ui.hintBar null"]);
    expect(got).toEqual(['"compact"']);
    await tick();
    core.emit({ key: "ui.hintBar", value: '"off"', source: "global" });
    core.emit({ key: "ui.keystrokes", value: "false", source: "global" });
    expect(got).toEqual(['"compact"', '"off"']);
    f.stop();
    await tick();
    core.emit({ key: "ui.hintBar", value: '"full"', source: "global" });
    expect(got).toEqual(['"compact"', '"off"']);
    expect(core.unlistened()).toBe(1);
  });

  it("reads again for each course opened", async () => {
    const core = fakeCore({ "ui.hintBar": '"off"', "ui.hintBar /c/STAT311": '"compact"' });
    const got: string[] = [];
    const [course, setCourse] = createSignal<string | null>(null);
    const f = createRoot(() => followSetting(core.deps, "ui.hintBar", course, (v) => got.push(v)));
    await core.answer();
    setCourse("/c/STAT311");
    await core.answer();
    expect(core.asked).toEqual(["ui.hintBar null", "ui.hintBar /c/STAT311"]);
    expect(got).toEqual(['"off"', '"compact"']);
    f.stop();
    setCourse("/c/MATH");
    await core.answer();
    expect(core.asked).toHaveLength(2);
  });

  it("drops a read that comes back after a newer read", async () => {
    const core = fakeCore({ "ui.hintBar /a": '"off"', "ui.hintBar /b": '"compact"' });
    const got: string[] = [];
    const [course, setCourse] = createSignal<string | null>("/a");
    const f = createRoot(() => followSetting(core.deps, "ui.hintBar", course, (v) => got.push(v)));
    setCourse("/b");
    // The newer read (/b) comes back first; the older one (/a) after it is dropped.
    await core.answer([1, 0]);
    expect(got).toEqual(['"compact"']);
    f.stop();
  });

  it("drops a read that comes back after an event or a write, even with a read asked since", async () => {
    for (const newer of ["event", "write"] as const) {
      const core = fakeCore({ "ui.hintBar /a": '"off"', "ui.hintBar /b": '"compact"' });
      const got: string[] = [];
      const [course, setCourse] = createSignal<string | null>("/a");
      const f = createRoot(() => followSetting(core.deps, "ui.hintBar", course, (v) => got.push(v)));
      await tick();
      if (newer === "event") core.emit({ key: "ui.hintBar", value: '"full"', source: "global" });
      else f.write('"full"');
      setCourse("/b");
      await core.answer([1, 0]);
      expect(got, newer).toEqual(newer === "event" ? ['"full"', '"compact"'] : ['"compact"']);
      f.stop();
    }
  });

  it("writes the app's own change to the global settings, and a read asked before it doesn't undo it", async () => {
    const core = fakeCore({ "ui.keystrokes": "true" });
    const got: string[] = [];
    const f = followSetting(
      core.deps,
      "ui.keystrokes",
      () => null,
      (v) => got.push(v),
    );
    f.write("false");
    expect(core.written).toEqual(["ui.keystrokes=false null"]);
    await core.answer();
    expect(got).toEqual([]);
    f.stop();
  });

  it("applies nothing after it stops, even a read already asked, and stops listening once it can", async () => {
    const core = fakeCore({ "ui.hintBar": '"off"' });
    const got: string[] = [];
    const f = followSetting(
      core.deps,
      "ui.hintBar",
      () => null,
      (v) => got.push(v),
    );
    f.stop();
    await core.answer();
    await tick();
    expect(got).toEqual([]);
    expect(core.unlistened()).toBe(1);
  });
});
