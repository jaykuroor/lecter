import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import type { Setting } from "../../core/bindings";
import { type FollowDeps, followSetting } from "./follow";

/** A fake core: reads answer from `values` when `release` is called, in order; events go to the listener. */
function fakeCore(values: Record<string, string>) {
  const pending: (() => void)[] = [];
  const asked: string[] = [];
  let listener: ((s: Setting) => void) | null = null;
  let unlistened = 0;
  const deps: FollowDeps = {
    get: (key, course) => {
      asked.push(`${key} ${course}`);
      return new Promise((resolve) => {
        pending.push(() => resolve({ status: "ok", data: { key, value: values[key] ?? "null", source: "global" } }));
      });
    },
    listen: (l) => {
      listener = l;
      return Promise.resolve(() => {
        unlistened += 1;
        listener = null;
      });
    },
  };
  const release = async () => {
    for (const r of pending.splice(0)) r();
    await Promise.resolve();
    await Promise.resolve();
  };
  const emit = (s: Setting) => listener?.(s);
  return { deps, asked, release, emit, unlistened: () => unlistened, values };
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
    await core.release();
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
    const core = fakeCore({ "ui.hintBar": '"off"' });
    const got: string[] = [];
    const [course, setCourse] = createSignal<string | null>(null);
    const f = createRoot(() => followSetting(core.deps, "ui.hintBar", course, (v) => got.push(v)));
    await core.release();
    setCourse("/c/STAT311");
    await core.release();
    expect(core.asked).toEqual(["ui.hintBar null", "ui.hintBar /c/STAT311"]);
    expect(got).toEqual(['"off"', '"off"']);
    f.stop();
    setCourse("/c/MATH");
    await core.release();
    expect(core.asked).toHaveLength(2);
  });

  it("drops a read that comes back after a newer value: a key pressed or an event", async () => {
    const core = fakeCore({ "ui.keystrokes": "true" });
    const got: string[] = [];
    const f = followSetting(
      core.deps,
      "ui.keystrokes",
      () => null,
      (v) => got.push(v),
    );
    f.touched();
    await core.release();
    expect(got).toEqual([]);
    await tick();
    const g = followSetting(
      core.deps,
      "ui.keystrokes",
      () => null,
      (v) => got.push(`g ${v}`),
    );
    await tick();
    core.emit({ key: "ui.keystrokes", value: "false", source: "global" });
    await core.release();
    expect(got).toEqual(["g false"]);
    f.stop();
    g.stop();
  });

  it("applies nothing after it stops, even a read already asked", async () => {
    const core = fakeCore({ "ui.hintBar": '"off"' });
    const got: string[] = [];
    const f = followSetting(
      core.deps,
      "ui.hintBar",
      () => null,
      (v) => got.push(v),
    );
    f.stop();
    await core.release();
    await tick();
    expect(got).toEqual([]);
    expect(core.unlistened()).toBe(1);
  });
});
