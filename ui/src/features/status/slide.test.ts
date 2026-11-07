import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { sampleLecture } from "../../../e2e/mock-core/lectures";
import { lectureDecorations } from "../buffer/decorations";
import type { SlidePos } from "./labels";
import { MAX_SCAN, slideAt, slideReport } from "./slide";

// 09-ui.md#layout: the status line shows the slide the cursor is in, numbered as the slide heading
// shows ("SLIDE n / N", components.md#slide-heading).

const state = (text: string, line: number) => {
  const s = EditorState.create({ doc: text, extensions: [lectureDecorations] });
  return s.update({ selection: EditorSelection.cursor(s.doc.line(line).from) }).state;
};
/** The 1-based number of the first line of the sample that reads `text`. */
const lineOf = (text: string) => sampleLecture.split("\n").indexOf(text) + 1;

describe("slideAt", () => {
  it("is the slide whose block the cursor is on, with the lecture's slide count", () => {
    expect(slideAt(state(sampleLecture, lineOf("[It is zero for independent variables.]{#s1b2}")))).toEqual({
      n: 1,
      total: 3,
    });
    expect(slideAt(state(sampleLecture, lineOf("[Roll two dice and compare the sums.]{#s3b1}")))).toEqual({
      n: 3,
      total: 3,
    });
  });

  it("is the slide around a gloss or a note inside it, not the gloss's own fence", () => {
    expect(slideAt(state(sampleLecture, lineOf("**you asked:** how do we get the 2Cov term?")))).toEqual({
      n: 2,
      total: 3,
    });
    expect(slideAt(state(sampleLecture, lineOf("Try it with numbers.")))).toEqual({ n: 2, total: 3 });
  });

  it("takes the number the fence gives (n=), as the heading shows it", () => {
    const text = ["::: {.slide #s9 n=9}", "## Late", "", "[x]{#s9b1}", ":::"].join("\n");
    expect(slideAt(state(text, 4))).toEqual({ n: 9, total: 1 });
  });

  it("is none above the first slide or in a lecture without slides", () => {
    expect(slideAt(state(sampleLecture, lineOf("title: Covariance and Correlation")))).toBeNull();
    expect(slideAt(state("just a note\nand another", 2))).toBeNull();
  });

  it("is none in a state without the lecture's decorations, even on a slide's block", () => {
    const plain = EditorState.create({ doc: sampleLecture });
    const at = plain.doc.line(lineOf("[Roll two dice and compare the sums.]{#s3b1}")).from;
    expect(slideAt(plain.update({ selection: EditorSelection.cursor(at) }).state)).toBeNull();
  });

  it("doesn't take a fence-like line in the front matter for a slide", () => {
    const text = ["---", "lecter: 1", "::: {.slide #s9 n=9}", "---", "", "text before any slide"].join("\n");
    expect(slideAt(state(text, 6))).toBeNull();
  });

  it("still finds a slide more than MAX_SCAN lines above the cursor", () => {
    const notes = Array.from({ length: MAX_SCAN + 10 }, (_, i) => `note ${i}`);
    const text = [
      "::: {.slide #s1 n=1}",
      "## One",
      "",
      "[x]{#s1b1}",
      ":::",
      "::: {.slide #s2 n=2}",
      "## Two",
      ...notes,
    ];
    const s = state(text.join("\n"), text.length);
    expect(slideAt(s)).toEqual({ n: 2, total: 2 });
  });

  it("finds none far below text that has no slide at all", () => {
    const notes = Array.from({ length: MAX_SCAN + 10 }, (_, i) => `note ${i}`);
    expect(slideAt(state(notes.join("\n"), notes.length))).toBeNull();
  });
});

describe("slideReport", () => {
  let view: EditorView | undefined;
  afterEach(() => view?.destroy());

  it("reports the slide when the cursor moves or the text changes, and only then", () => {
    const seen: (SlidePos | null)[] = [];
    view = new EditorView({
      state: EditorState.create({
        doc: sampleLecture,
        extensions: [lectureDecorations, slideReport((s) => seen.push(s))],
      }),
    });
    const doc = () => view?.state.doc ?? EditorState.create().doc;
    view.dispatch({ selection: { anchor: doc().line(lineOf("[Roll two dice and compare the sums.]{#s3b1}")).from } });
    expect(seen).toEqual([{ n: 3, total: 3 }]);
    // A change that adds no slide: still slide 3 of 3, reported again (the sink keeps equal ones).
    view.dispatch({ changes: { from: doc().length, insert: "more" } });
    expect(seen).toEqual([
      { n: 3, total: 3 },
      { n: 3, total: 3 },
    ]);
    // Neither: nothing reported.
    view.dispatch({ scrollIntoView: true });
    expect(seen).toHaveLength(2);
    view.dispatch({ selection: { anchor: doc().line(lineOf("[It is zero for independent variables.]{#s1b2}")).from } });
    expect(seen.at(-1)).toEqual({ n: 1, total: 3 });
  });
});
