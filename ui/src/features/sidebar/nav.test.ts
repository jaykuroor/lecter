import { describe, expect, it } from "vitest";
import { createRowMoves } from "./nav";

// 09-ui.md#slack-and-discord-behaviours: arrow keys and Enter work in every list, Vim keys too
// (j/k, gg/G). The sidebar's rows move by these; Enter is the row's own.

describe("createRowMoves", () => {
  it("moves down with j and ArrowDown, up with k and ArrowUp", () => {
    const move = createRowMoves();
    expect(move("j", 0, 5)).toBe(1);
    expect(move("ArrowDown", 3, 5)).toBe(4);
    expect(move("k", 3, 5)).toBe(2);
    expect(move("ArrowUp", 1, 5)).toBe(0);
  });

  it("stays on the last row going down and on the first going up", () => {
    const move = createRowMoves();
    expect(move("j", 4, 5)).toBe(4);
    expect(move("ArrowDown", 4, 5)).toBe(4);
    expect(move("k", 0, 5)).toBe(0);
    expect(move("ArrowUp", 0, 5)).toBe(0);
  });

  it("goes to the first row with Home or gg, and the last with End or G", () => {
    const move = createRowMoves();
    expect(move("Home", 3, 5)).toBe(0);
    expect(move("End", 1, 5)).toBe(4);
    expect(move("G", 0, 5)).toBe(4);
    expect(move("g", 3, 5)).toBe("pending");
    expect(move("g", 3, 5)).toBe(0);
  });

  it("forgets a lone g when another key follows", () => {
    const move = createRowMoves();
    expect(move("g", 3, 5)).toBe("pending");
    expect(move("j", 3, 5)).toBe(4);
    // The g before j no longer counts: this g starts a new gg.
    expect(move("g", 2, 5)).toBe("pending");
    expect(move("x", 2, 5)).toBeNull();
    expect(move("g", 2, 5)).toBe("pending");
  });

  it("leaves every other key alone", () => {
    const move = createRowMoves();
    for (const key of ["Enter", " ", "a", "J", "K", "ArrowLeft", "ArrowRight", "Tab", "Escape", "e"]) {
      expect(move(key, 2, 5), key).toBeNull();
    }
  });

  it("has nowhere to go in an empty list", () => {
    const move = createRowMoves();
    expect(move("j", 0, 0)).toBeNull();
    expect(move("End", 0, 0)).toBeNull();
  });
});
