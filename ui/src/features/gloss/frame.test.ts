// F-023 criterion 2: stream updates are drawn at most once per animation frame.
import { describe, expect, it } from "vitest";
import { FrameBatcher } from "./frame";

/** A fake frame clock: scheduled callbacks run when the test calls `frame()`. */
function clock() {
  let queued: (() => void)[] = [];
  return {
    schedule: (cb: () => void) => queued.push(cb),
    pending: () => queued.length,
    frame: () => {
      const run = queued;
      queued = [];
      for (const cb of run) cb();
    },
  };
}

function batcher() {
  const c = clock();
  const writes: string[] = [];
  return { c, writes, b: new FrameBatcher((t) => writes.push(t), c.schedule) };
}

describe("FrameBatcher", () => {
  it("joins every delta of a frame into one write", () => {
    const { c, writes, b } = batcher();
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
    const { c, writes, b } = batcher();
    for (let f = 0; f < 3; f++) {
      for (let d = 0; d < 10; d++) b.push(`${f}`);
      expect(c.pending()).toBe(1);
      c.frame();
    }
    expect(writes).toEqual(["0000000000", "1111111111", "2222222222"]);
  });

  it("discard drops pending text: its frame writes nothing, and the next text goes alone", () => {
    const { c, writes, b } = batcher();
    b.push("late");
    b.discard();
    c.frame();
    expect(writes).toEqual([]);
    b.push("next");
    expect(c.pending()).toBe(1);
    c.frame();
    expect(writes).toEqual(["next"]);
  });

  it("uses the browser's animation frames by default", () => {
    const writes: string[] = [];
    const queued: FrameRequestCallback[] = [];
    const real = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => queued.push(cb);
    try {
      const b = new FrameBatcher((t) => writes.push(t));
      b.push("a");
      b.push("b");
      expect(queued).toHaveLength(1);
      queued[0]?.(0);
      expect(writes).toEqual(["ab"]);
    } finally {
      globalThis.requestAnimationFrame = real;
    }
  });
});
