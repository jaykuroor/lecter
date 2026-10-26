// F-023 criterion 2: stream updates are drawn at most once per animation frame.
import { describe, expect, it } from "vitest";
import { FrameBatcher } from "./frame";

/** A fake frame clock: scheduled callbacks run when the test calls `frame()`. */
function clock() {
  let next = 1;
  const queued = new Map<number, () => void>();
  return {
    schedule: (cb: () => void) => {
      const h = next++;
      queued.set(h, cb);
      return h;
    },
    unschedule: (h: number) => void queued.delete(h),
    pending: () => queued.size,
    frame: () => {
      const run = [...queued.values()];
      queued.clear();
      for (const cb of run) cb();
    },
  };
}

describe("FrameBatcher", () => {
  it("joins every delta of a frame into one write", () => {
    const c = clock();
    const writes: string[] = [];
    const b = new FrameBatcher((t) => writes.push(t), c.schedule, c.unschedule);
    b.push("Expand ");
    b.push("the ");
    b.push("square.");
    expect(writes).toEqual([]);
    expect(c.pending()).toBe(1);
    c.frame();
    expect(writes).toEqual(["Expand the square."]);
    c.frame();
    expect(writes).toEqual(["Expand the square."]);
  });

  it("writes once per frame while a stream goes on", () => {
    const c = clock();
    const writes: string[] = [];
    const b = new FrameBatcher((t) => writes.push(t), c.schedule, c.unschedule);
    for (let f = 0; f < 3; f++) {
      for (let d = 0; d < 10; d++) b.push(`${f}`);
      c.frame();
    }
    expect(writes).toEqual(["0000000000", "1111111111", "2222222222"]);
  });

  it("flush writes what is pending at once and drops the frame", () => {
    const c = clock();
    const writes: string[] = [];
    const b = new FrameBatcher((t) => writes.push(t), c.schedule, c.unschedule);
    b.push("a");
    b.flush();
    expect(writes).toEqual(["a"]);
    expect(c.pending()).toBe(0);
    b.flush();
    expect(writes).toEqual(["a"]);
  });

  it("discard drops pending text without writing it", () => {
    const c = clock();
    const writes: string[] = [];
    const b = new FrameBatcher((t) => writes.push(t), c.schedule, c.unschedule);
    b.push("late");
    b.discard();
    c.frame();
    expect(writes).toEqual([]);
    expect(c.pending()).toBe(0);
  });

  it("an empty delta schedules nothing", () => {
    const c = clock();
    const b = new FrameBatcher(() => undefined, c.schedule, c.unschedule);
    b.push("");
    expect(c.pending()).toBe(0);
  });
});
