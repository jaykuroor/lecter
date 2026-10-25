import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { sampleLecture } from "../../../e2e/mock-core/lectures";
import { cursorRules, showingSelection } from "./cursor";

const state = (anchor = 0) =>
  EditorState.create({
    doc: sampleLecture,
    selection: { anchor },
    extensions: [cursorRules, EditorState.allowMultipleSelections.of(true)],
  });

describe("cursor rules", () => {
  const s0 = state();
  const l14 = s0.doc.line(14);
  const l23 = s0.doc.line(23);
  const textEnd14 = l14.from + l14.text.indexOf("]{#s1b1");

  it("moves a cursor that lands on a hidden line to the next element in its direction", () => {
    const start = state(l14.from + 3);
    // Down onto the closing fence (line 18): on to the next slide's first block.
    const down = start.update({ selection: { anchor: start.doc.line(18).from } }).state;
    expect(down.selection.main.head).toBe(l23.from + 1);
    // Up from line 23 onto the slide's title (line 21): back to the previous block's end.
    const from23 = state(l23.from + 2);
    const l16 = from23.doc.line(16);
    const up = from23.update({ selection: { anchor: from23.doc.line(21).from } }).state;
    expect(up.selection.main.head).toBe(l16.from + l16.text.indexOf("]{#s1b2"));
  });

  it("keeps a cursor inside a block's text, so typing lands in the span", () => {
    const s = state(l14.from + 5);
    const atStart = s.update({ selection: { anchor: l14.from } }).state;
    expect(atStart.selection.main.head).toBe(l14.from + 1);
    const typed = atStart.update({ changes: { from: l14.from + 1, insert: "X" }, selection: { anchor: l14.from + 2 } });
    expect(typed.state.doc.line(14).text.startsWith("[XCovariance")).toBe(true);
    const atEnd = s.update({ selection: { anchor: l14.to } }).state;
    expect(atEnd.selection.main.head).toBe(textEnd14);
  });

  it("moves only the head of a range selection and keeps every range", () => {
    const s = state(l14.from + 5);
    const tr = s.update({
      selection: EditorSelection.create(
        [EditorSelection.range(l14.from + 2, l14.to), EditorSelection.cursor(s.doc.line(28).from + 1)],
        1,
      ),
    });
    const sel = tr.state.selection;
    expect(sel.ranges.map((r) => [r.anchor, r.head])).toEqual([
      [l14.from + 2, textEnd14],
      [s.doc.line(28).from + 1, s.doc.line(28).from + 1],
    ]);
    expect(sel.mainIndex).toBe(1);
  });

  it("leaves transactions without a selection, and selections already showing, as they are", () => {
    const s = state(l14.from + 5);
    const edit = s.update({ changes: { from: s.doc.line(28).from, insert: "a" } });
    expect(showingSelection(edit)).toBeNull();
    const fine = s.update({ selection: { anchor: l14.from + 3 } });
    expect(showingSelection(fine)).toBeNull();
    expect(fine.state.selection.main.head).toBe(l14.from + 3);
  });
});
