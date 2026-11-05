import { describe, expect, it } from "vitest";
import { addKeys, EMPTY_STRIP, isPending, MAX_KEYS } from "./strip";

// The overlay's keys: the last ones typed, oldest first, with the ones the engine still holds
// marked (09-ui.md#hint-bar-and-keystroke-overlay: "including pending sequences").

describe("the overlay's strip of keys", () => {
  it("keeps the keys in the order typed, across frames", () => {
    const one = addKeys(EMPTY_STRIP, ["j", "k"], 0);
    expect(addKeys(one, ["<Space>"], 1)).toEqual({ keys: ["j", "k", "<Space>"], pending: 1 });
  });

  it("holds the last eight keys: a ninth drops the oldest", () => {
    const eight = addKeys(EMPTY_STRIP, ["1", "2", "3", "4", "5", "6", "7", "8"], 0);
    expect(eight.keys).toHaveLength(MAX_KEYS);
    expect(addKeys(eight, ["9"], 0).keys).toEqual(["2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(addKeys(EMPTY_STRIP, ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"], 0).keys).toEqual([
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
      "i",
      "j",
    ]);
  });

  it("marks the last keys the engine holds as pending, never more than it shows", () => {
    const strip = addKeys(EMPTY_STRIP, ["j", "<Space>", "u"], 2);
    expect([0, 1, 2].map((i) => isPending(strip, i))).toEqual([false, true, true]);
    expect(addKeys(EMPTY_STRIP, ["u"], 3)).toEqual({ keys: ["u"], pending: 1 });
    const none = addKeys(strip, ["<Esc>"], 0);
    expect([0, 1, 2, 3].map((i) => isPending(none, i))).toEqual([false, false, false, false]);
  });
});
