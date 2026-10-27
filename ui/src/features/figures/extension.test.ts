// When the figure set is rebuilt (an edit to a fence line or inside a spec) and when it is only
// mapped (any other edit: the keystroke path stays one pass over the changed lines).
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { figuresField, touchesFigures } from "./extension";
import type { FigureBlock } from "./find";

// Line starts: "aaaa" 0, "bbbb" 5, "cccc" 10, "dddd" 15, ":::" 20, "eeee" 24.
const DOC = ["aaaa", "bbbb", "cccc", "dddd", ":::", "eeee"].join("\n");
/** A block over "bbbb" to "cccc" (offsets 5 to 14); none of its lines is a fence. */
const BLOCK: FigureBlock = { from: 5, to: 14, source: "" };

function touches(spec: TransactionSpec, blocks: FigureBlock[] = [BLOCK]): boolean {
  return touchesFigures(EditorState.create({ doc: DOC }).update(spec), blocks);
}

describe("when figures are found again", () => {
  it("an edit inside a block, or at either end of it, touches it", () => {
    expect(touches({ changes: { from: 7, insert: "x" } })).toBe(true);
    expect(touches({ changes: { from: 5, insert: "x" } })).toBe(true);
    expect(touches({ changes: { from: 14, insert: "x" } })).toBe(true);
    expect(touches({ changes: { from: 0, to: 20, insert: "" } })).toBe(true);
  });

  it("an edit on plain lines outside every block doesn't", () => {
    expect(touches({ changes: { from: 2, insert: "x" } })).toBe(false);
    expect(touches({ changes: { from: 4, insert: "x" } })).toBe(false);
    expect(touches({ changes: { from: 15, insert: "x" } })).toBe(false);
    expect(touches({ changes: { from: 26, insert: "x" } })).toBe(false);
    expect(touches({ changes: { from: 7, insert: "x" } }, [])).toBe(false);
  });

  it("an edit on a fence line, before or after it, does", () => {
    expect(touches({ changes: { from: 21, insert: " {.gloss}" } })).toBe(true);
    expect(touches({ changes: { from: 20, to: 23, insert: "fine" } })).toBe(true);
    expect(touches({ changes: { from: 24, insert: "```\n" } })).toBe(true);
    // The fence is the last of the changed lines.
    expect(touches({ changes: { from: 17, to: 22, insert: "" } })).toBe(true);
    expect(touches({ changes: { from: 0, insert: "x\n```" } }, [])).toBe(true);
  });

  it("a fence anywhere in the changed lines counts, not only on the last one", () => {
    expect(touches({ changes: { from: 21, to: 26, insert: "\nzzzz\nyyyy" } })).toBe(true);
    expect(touches({ changes: { from: 0, insert: "```\nplain\n" } }, [])).toBe(true);
  });

  it("one touching range is enough, whatever the other ranges are", () => {
    expect(
      touches({
        changes: [
          { from: 7, insert: "x" },
          { from: 26, insert: "y" },
        ],
      }),
    ).toBe(true);
    expect(
      touches({
        changes: [
          { from: 21, insert: "x" },
          { from: 26, insert: "y" },
        ],
      }),
    ).toBe(true);
  });
});

const GLOSS = [
  "[A block.]{#s1b1}",
  "",
  '::: {.gloss #g-0001 kind=ask key=a anchor=s1b1 model="sample" by=ai}',
  "```fnplot",
  "{}",
  "```",
  ":::",
  "",
  "a note",
].join("\n");

describe("the figure set", () => {
  it("is kept as it is by a change of selection only", () => {
    const state = EditorState.create({ doc: GLOSS, extensions: figuresField });
    const next = state.update({ selection: { anchor: 3 } }).state;
    expect(next.field(figuresField)).toBe(state.field(figuresField));
  });

  it("maps its blocks through edits elsewhere and finds them again after edits to them", () => {
    const state = EditorState.create({ doc: GLOSS, extensions: figuresField });
    const [block] = state.field(figuresField).blocks;
    expect(block).toEqual({ from: GLOSS.indexOf("```fnplot"), to: GLOSS.indexOf("```\n:::") + 3, source: "{}" });
    // Typing in the block line above: mapped, three characters later.
    const typed = state.update({ changes: { from: 2, insert: "abc" } }).state;
    expect(typed.field(figuresField).blocks).toEqual([
      { from: (block?.from ?? 0) + 3, to: (block?.to ?? 0) + 3, source: "{}" },
    ]);
    expect(typed.field(figuresField).deco.size).toBe(1);
    // Typing in the note below changes nothing in the set.
    const below = typed.update({ changes: { from: typed.doc.length, insert: "!" } }).state;
    expect(below.field(figuresField).blocks).toEqual(typed.field(figuresField).blocks);
    // Editing the spec: found again, with the new spec.
    const at = (below.field(figuresField).blocks[0]?.from ?? 0) + "```fnplot\n".length;
    const edited = below.update({ changes: { from: at + 1, insert: '"a":1' } }).state;
    expect(edited.field(figuresField).blocks.map((b) => b.source)).toEqual(['{"a":1}']);
  });
});
