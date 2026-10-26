import { ChangeSet, EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import type { Edit } from "../../core/lecture";
import { editsOf, MAX_EDIT_UNITS, sendEdits } from "./edits";

/** Applies edits one after another, as the core does (UTF-16 positions, each after the last). */
function replay(doc: string, edits: Edit[]): string {
  let out = doc;
  for (const e of edits) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  return out;
}

describe("buffer edits for the core", () => {
  it("turns one typed character into one insert", () => {
    const doc = Text.of(["Covariance"]);
    const changes = ChangeSet.of({ from: 10, insert: "!" }, doc.length);
    expect(editsOf(changes)).toEqual([{ from: 10, to: 10, text: "!" }]);
  });

  it("orders several changes last-first so each counts after the one before", () => {
    const text = "alpha beta gamma";
    const changes = ChangeSet.of(
      [
        { from: 0, to: 5, insert: "A" },
        { from: 6, to: 10, insert: "B" },
        { from: 16, insert: "!" },
      ],
      text.length,
    );
    const edits = editsOf(changes);
    expect(edits).toEqual([
      { from: 16, to: 16, text: "!" },
      { from: 6, to: 10, text: "B" },
      { from: 0, to: 5, text: "A" },
    ]);
    expect(replay(text, edits)).toBe(changes.apply(Text.of([text])).toString());
  });

  it("counts UTF-16 units, as CodeMirror does", () => {
    const text = "é𝑥 = 1";
    const changes = ChangeSet.of({ from: 4, to: 5, insert: "≈" }, text.length);
    expect(editsOf(changes)).toEqual([{ from: 4, to: 5, text: "≈" }]);
    expect(replay(text, editsOf(changes))).toBe("é𝑥 ≈ 1");
  });

  it("sends a long paste as consecutive inserts under the core's string limit", () => {
    // A surrogate pair straddles the first piece's end: it must stay whole.
    const paste = `${"a".repeat(MAX_EDIT_UNITS - 1)}𝑥${"b".repeat(MAX_EDIT_UNITS + 5)}`;
    const changes = ChangeSet.of({ from: 2, to: 3, insert: paste }, 4);
    const edits = editsOf(changes);
    expect(edits.map((e) => [e.from, e.to, e.text.length])).toEqual([
      [2, 3, MAX_EDIT_UNITS - 1],
      [2 + MAX_EDIT_UNITS - 1, 2 + MAX_EDIT_UNITS - 1, MAX_EDIT_UNITS],
      [2 + 2 * MAX_EDIT_UNITS - 1, 2 + 2 * MAX_EDIT_UNITS - 1, 7],
    ]);
    expect(edits.every((e) => e.text.length <= MAX_EDIT_UNITS)).toBe(true);
    expect(replay("wxyz", edits)).toBe(`wx${paste}z`);
  });

  it("reports every document change of a view and nothing else", () => {
    const sent: Edit[][] = [];
    const view = new EditorView({
      state: EditorState.create({ doc: "ab", extensions: sendEdits((e) => sent.push(e)) }),
    });
    view.dispatch({ selection: { anchor: 1 } });
    view.dispatch({ changes: { from: 1, insert: "X" } });
    view.dispatch({ changes: { from: 0, to: 1 } });
    expect(sent).toEqual([[{ from: 1, to: 1, text: "X" }], [{ from: 0, to: 1, text: "" }]]);
    expect(replay("ab", sent.flat())).toBe(view.state.doc.toString());
    view.destroy();
  });
});
