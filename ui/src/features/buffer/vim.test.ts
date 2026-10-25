import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { sampleLecture } from "../../../e2e/mock-core/lectures";
import { ELEMENT_KEYS, edgeMotion, elementMotion, lectureBuffer, registerElementMotions, type VimApi } from "./vim";

const lecture = EditorState.create({ doc: sampleLecture, extensions: lectureBuffer.of(true) });
const plain = EditorState.create({ doc: "abcd\nx\nxyz" });

interface Args {
  repeat?: number;
  forward?: boolean;
  repeatIsExplicit?: boolean;
  operator?: string;
}

/** Runs a motion the way Vim does: on the editor's state, from `head`, with the key's args. */
function run(motion: typeof elementMotion, state: EditorState, line: number, ch: number, a: Args = {}) {
  const cm = { cm6: { state } };
  const args = { repeat: a.repeat ?? 1, forward: a.forward ?? true, repeatIsExplicit: a.repeatIsExplicit ?? false };
  return motion(cm as never, { line, ch }, args as never, {} as never, { operator: a.operator ?? null } as never);
}

// Sample element lines, 0-based: 13, 15, 22, 24 (blocks), 27 (gloss text), 31 (note text), 38 (block).
describe("j and k in a lecture", () => {
  it("keep the column within the block's text", () => {
    expect(run(elementMotion, lecture, 13, 5)).toEqual({ line: 15, ch: 5 });
    expect(run(elementMotion, lecture, 15, 5, { forward: false })).toEqual({ line: 13, ch: 5 });
  });

  it("stop on the last character of a shorter block", () => {
    // Line 16's text is 37 characters (columns 1-37), between `[` (column 0) and `]` (column 38).
    expect(run(elementMotion, lecture, 13, 50)).toEqual({ line: 15, ch: 37 });
  });

  it("start from the text when the cursor sits on the hidden bracket", () => {
    expect(run(elementMotion, lecture, 15, 0, { forward: false })).toEqual({ line: 13, ch: 1 });
  });

  it("keep the column onto a text line, which has no brackets", () => {
    expect(run(elementMotion, lecture, 24, 3)).toEqual({ line: 27, ch: 2 });
  });

  it("take a count and stay at the last element", () => {
    expect(run(elementMotion, lecture, 13, 1, { repeat: 3 })).toEqual({ line: 24, ch: 1 });
    expect(run(elementMotion, lecture, 38, 4)).toEqual({ line: 38, ch: 4 });
  });

  it("move by real lines with an operator pending", () => {
    expect(run(elementMotion, lecture, 13, 2, { operator: "d" })).toEqual({ line: 14, ch: 0 });
  });
});

describe("gg and G in a lecture", () => {
  it("go to the first and last element, or the counted one", () => {
    expect(run(edgeMotion, lecture, 30, 3, { forward: false })).toEqual({ line: 13, ch: 1 });
    expect(run(edgeMotion, lecture, 13, 3)).toEqual({ line: 38, ch: 1 });
    expect(run(edgeMotion, lecture, 13, 3, { repeat: 4, repeatIsExplicit: true })).toEqual({ line: 24, ch: 1 });
    expect(run(edgeMotion, lecture, 13, 3, { repeat: 5, repeatIsExplicit: true, forward: false })).toEqual({
      line: 27,
      ch: 0,
    });
  });
});

describe("the motions in an editor that isn't a lecture", () => {
  it("move by plain lines, clamped to the document and the line's length", () => {
    expect(run(elementMotion, plain, 0, 3)).toEqual({ line: 1, ch: 1 });
    expect(run(elementMotion, plain, 0, 3, { repeat: 2 })).toEqual({ line: 2, ch: 3 });
    expect(run(elementMotion, plain, 0, 3, { repeat: 9 })).toEqual({ line: 2, ch: 3 });
    expect(run(elementMotion, plain, 1, 0, { repeat: 5, forward: false })).toEqual({ line: 0, ch: 0 });
  });

  it("go to the first, last or counted line", () => {
    expect(run(edgeMotion, plain, 1, 1)).toEqual({ line: 2, ch: 0 });
    expect(run(edgeMotion, plain, 1, 1, { forward: false })).toEqual({ line: 0, ch: 0 });
    expect(run(edgeMotion, plain, 0, 0, { repeat: 2, repeatIsExplicit: true })).toEqual({ line: 1, ch: 0 });
  });
});

describe("registration", () => {
  it("maps exactly j, k, gg and G (10-keymap.md#move-everywhere), once", () => {
    const calls: unknown[][] = [];
    const api: VimApi = {
      defineMotion: (name, fn) => calls.push(["define", name, fn]),
      mapCommand: (...args) => calls.push(["map", ...args]),
    };
    registerElementMotions(api);
    registerElementMotions(api);
    expect(calls).toEqual([
      ["define", "lecterElement", elementMotion],
      ["define", "lecterEdge", edgeMotion],
      ["map", "j", "motion", "lecterElement", { forward: true, linewise: true }, {}],
      ["map", "k", "motion", "lecterElement", { forward: false, linewise: true }, {}],
      [
        "map",
        "gg",
        "motion",
        "lecterEdge",
        { forward: false, explicitRepeat: true, linewise: true, toJumplist: true },
        {},
      ],
      [
        "map",
        "G",
        "motion",
        "lecterEdge",
        { forward: true, explicitRepeat: true, linewise: true, toJumplist: true },
        {},
      ],
    ]);
    expect(ELEMENT_KEYS.map(([keys]) => keys)).toEqual(["j", "k", "gg", "G"]);
  });
});
