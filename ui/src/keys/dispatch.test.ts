import { afterEach, describe, expect, it } from "vitest";
import { registerCommand } from "./commands";
import { runWithoutKey, vimTakes } from "./dispatch";
import type { Binding } from "./keymap";
import type { BufferTarget } from "./locate";

// A key whose command nobody handles goes on to Vim in the buffer, except a given-up Vim key alone
// (10-keymap.md#vim-subset-kept); a click on its hint does the same (F-038).

const drops: (() => void)[] = [];
afterEach(() => {
  for (const drop of drops.splice(0)) drop();
});

const binding = (keys: string, command: string): Binding => ({ keys, command, scope: "line", desc: command });

/** A buffer that records what Vim was handed. */
function fakeBuffer(): BufferTarget & { got: string[][] } {
  const got: string[][] = [];
  return {
    got,
    root: document.createElement("div"),
    mode: () => "normal",
    element: () => "slide-line",
    focus: () => {},
    replay: (tokens) => {
      got.push([...tokens]);
    },
  };
}

describe("vimTakes", () => {
  it("keeps a given-up key alone from Vim, and lets every other key through", () => {
    for (const k of ["s", "q", "t", "m", "<Tab>", "<CR>", "=", "'"]) expect(vimTakes([k])).toBe(false);
    for (const k of [["i"], ["o"], ["<C-j>"], ["]", "]"], ["g", "d"], ["s", "s"]]) expect(vimTakes(k)).toBe(true);
  });
});

describe("runWithoutKey", () => {
  it("runs the handler, once, with a count of 1, and leaves Vim alone", () => {
    const calls: string[] = [];
    drops.push(
      registerCommand("ai.steps", ({ count, explicit }) => {
        calls.push(`${count} ${explicit}`);
        return true;
      }),
    );
    const buffer = fakeBuffer();
    expect(runWithoutKey(binding("x", "ai.steps"), ["x"], buffer)).toBe(true);
    expect(calls).toEqual(["1 false"]);
    expect(buffer.got).toEqual([]);
  });

  it("hands the keys to Vim when nobody handles the command, or its handler declines", () => {
    const buffer = fakeBuffer();
    expect(runWithoutKey(binding("]]", "slide.next"), ["]", "]"], buffer)).toBe(true);
    drops.push(registerCommand("line.edit", () => false));
    expect(runWithoutKey(binding("i", "line.edit"), ["i"], buffer)).toBe(true);
    expect(buffer.got).toEqual([["]", "]"], ["i"]]);
  });

  it("does nothing for a given-up key with no handler, or off the buffer", () => {
    const buffer = fakeBuffer();
    expect(runWithoutKey(binding("s", "ai.steps"), ["s"], buffer)).toBe(false);
    expect(runWithoutKey(binding("i", "line.edit"), ["i"], null)).toBe(false);
    expect(buffer.got).toEqual([]);
  });
});
