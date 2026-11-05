import { describe, expect, it } from "vitest";
import { moveItem } from "./order";

describe("moveItem", () => {
  const abcd = ["a", "b", "c", "d"] as const;

  it("moves an item down, to the place it was dropped on", () => {
    expect(moveItem(abcd, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(abcd, 1, 3)).toEqual(["a", "c", "d", "b"]);
  });

  it("moves an item up", () => {
    expect(moveItem(abcd, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveItem(abcd, 2, 1)).toEqual(["a", "c", "b", "d"]);
  });

  it("leaves the order alone for a move onto itself", () => {
    expect(moveItem(abcd, 2, 2)).toEqual(["a", "b", "c", "d"]);
  });

  it("clamps a target past either end to that end", () => {
    expect(moveItem(abcd, 1, 9)).toEqual(["a", "c", "d", "b"]);
    expect(moveItem(abcd, 1, 4)).toEqual(["a", "c", "d", "b"]);
    expect(moveItem(abcd, 2, -4)).toEqual(["c", "a", "b", "d"]);
  });

  it("returns the order unchanged for a source that isn't in it", () => {
    expect(moveItem(abcd, 4, 0)).toEqual(["a", "b", "c", "d"]);
    expect(moveItem(abcd, -1, 0)).toEqual(["a", "b", "c", "d"]);
  });

  it("never changes the array it was given", () => {
    const order = ["a", "b"];
    const moved = moveItem(order, 0, 1);
    expect(order).toEqual(["a", "b"]);
    expect(moved).toEqual(["b", "a"]);
    expect(moved).not.toBe(order);
  });
});
