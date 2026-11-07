// F-023 criterion 3: a gloss goes under its block in the lecture file (03-lecture-files.md#body);
// F-048: or under the own note it was asked on.
import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { anchorLine, glossInsertPos, noteAt } from "./place";

const doc = (lines: string[]) => Text.of(lines);

const LECTURE = [
  '::: {.slide #s3 n=3 title="Properties"}', // 1
  "## Properties", // 2
  "", // 3
  "[Covariance is bilinear.]{#s3b1}", // 4
  "", // 5
  "[Var(X+Y) adds 2Cov.]{#s3b2 .flag}", // 6
  "", // 7
  "::: {.gloss #g-7f3a kind=steps key=s anchor=s3b2}", // 8
  "**you asked:** how?", // 9
  "", // 10
  "::: {.gloss #g-0002 anchor=s3b2 target=thread}", // 11
  "a reply", // 12
  ":::", // 13
  ":::", // 14
  "", // 15
  "::: {.note #n-91c0 anchor=s3b2}", // 16
  "Try it with numbers.", // 17
  ":::", // 18
  "", // 19
  "::: {.note #n-0001 anchor=s3b1}", // 20
  "not mine", // 21
  ":::", // 22
  ":::", // 23
];

describe("anchorLine", () => {
  it("finds a block's line by its exact id", () => {
    const d = doc(LECTURE);
    expect(anchorLine(d, "s3b1")).toBe(4);
    expect(anchorLine(d, "s3b2")).toBe(6);
    expect(anchorLine(d, "s3b")).toBeNull();
    expect(anchorLine(d, "s3b3")).toBeNull();
    // Text that mentions an id isn't the block.
    expect(anchorLine(doc(["see {#s1b1}", "x[y]{#s1b1}"]), "s1b1")).toBeNull();
  });

  // F-048 criterion 2: a gloss on an own note goes after the note's div.
  it("finds an own note's closing fence by its exact id", () => {
    const d = doc(LECTURE);
    expect(anchorLine(d, "n-91c0")).toBe(18);
    expect(anchorLine(d, "n-0001")).toBe(22);
    expect(anchorLine(d, "n-91c")).toBeNull();
    expect(anchorLine(d, "n-ffff")).toBeNull();
    // A gloss with that id, a note never closed, and a fence that only mentions the id are not it.
    expect(anchorLine(doc(["::: {.gloss #n-0002}", ":::"]), "n-0002")).toBeNull();
    expect(anchorLine(doc(["::: {.note #n-0003}", "open"]), "n-0003")).toBeNull();
    expect(anchorLine(doc(['::: {.note title="#n-0004"}', ":::", "x::: {.note #n-0004}", ":::"]), "n-0004")).toBeNull();
    // A block id names the block, never a note div that happens to carry it.
    expect(anchorLine(doc(["::: {.note #s1b1}", ":::", "[A]{#s1b1}"]), "s1b1")).toBe(3);
    // Only a whole note id is one: nothing before `n-`, four to eight hex digits, nothing after.
    expect(anchorLine(doc(["::: {.note #xn-0006}", ":::", "::: {.note #n-0006x}", ":::"]), "xn-0006")).toBeNull();
    expect(anchorLine(doc(["::: {.note #n-0006x}", ":::"]), "n-0006x")).toBeNull();
    // Nested divs inside the note are counted.
    const nested = doc(["::: {.note #n-0005}", "a", "::: {.gloss #g-0001 anchor=n-0005}", "b", ":::", ":::"]);
    expect(anchorLine(nested, "n-0005")).toBe(6);
    expect(glossInsertPos(nested, 6, "n-0005")).toBe(nested.line(6).to);
  });

  it("goes after the glosses already anchored to a note", () => {
    const d = doc(["::: {.note #n-0005}", "a", ":::", "", "::: {.gloss #g-0001 anchor=n-0005}", "b", ":::", "c"]);
    expect(glossInsertPos(d, 3, "n-0005")).toBe(d.line(7).to);
  });
});

describe("noteAt", () => {
  it("names the own note a line is in, its fences included", () => {
    const d = doc(LECTURE);
    expect([16, 17, 18, 20, 21].map((n) => noteAt(d, n))).toEqual(["n-91c0", "n-91c0", "n-91c0", "n-0001", "n-0001"]);
  });

  it("is null on a slide line, in a gloss, outside any div, or in a note without a valid id", () => {
    const d = doc(LECTURE);
    expect([4, 9, 12, 19].map((n) => noteAt(d, n))).toEqual([null, null, null, null]);
    expect(noteAt(doc(["mine", "more"]), 1)).toBeNull();
    const bad = doc(["::: {.note}", "a", ":::", "::: {.note #n-XYZ1}", "b", ":::", "::: {.gloss #n-0001}", "c", ":::"]);
    expect([2, 5, 8].map((n) => noteAt(bad, n))).toEqual([null, null, null]);
    const partial = doc(["::: {.note #xn-0001}", "a", ":::", "::: {.note #n-0001x}", "b", ":::"]);
    expect([2, 5].map((n) => noteAt(partial, n))).toEqual([null, null]);
  });
});

describe("glossInsertPos", () => {
  it("goes right after a block with nothing anchored to it", () => {
    const d = doc(LECTURE);
    expect(glossInsertPos(d, 4, "s3b1")).toBe(d.line(4).to);
  });

  it("goes after the glosses and notes already anchored to the block, nested replies included", () => {
    const d = doc(LECTURE);
    expect(glossInsertPos(d, 6, "s3b2")).toBe(d.line(18).to);
  });

  it("stops at an unclosed div instead of running to the end", () => {
    const d = doc(["[A]{#s1b1}", "", "::: {.gloss #g-0001 anchor=s1b1}", "never closed"]);
    expect(glossInsertPos(d, 1, "s1b1")).toBe(d.line(1).to);
  });

  it("finds a block on the file's last line, past lines that start with [ but aren't blocks", () => {
    const d = doc(["[a link](x) first", "[not a block]{.x}", "[Last.]{#s2b1}"]);
    expect(anchorLine(d, "s2b1")).toBe(3);
  });

  it("skips whitespace-only lines and a div that closes on the file's last line", () => {
    const d = doc(["[A]{#s1b1}", "   ", "::::{.gloss #g-0001 anchor=s1b1}", "answer", "::::"]);
    expect(glossInsertPos(d, 1, "s1b1")).toBe(d.line(5).to);
  });

  it("counts only whole fence lines inside a div", () => {
    const d = doc([
      "[A]{#s1b1}",
      "",
      "::: {.gloss #g-0001 anchor=s1b1}",
      ":::x",
      "text :::",
      "::: {.note #n-0001 anchor=s1b1}",
      "nested",
      ":::",
      ":::",
      "after",
    ]);
    expect(glossInsertPos(d, 1, "s1b1")).toBe(d.line(9).to);
  });

  it("stops at a div that isn't a gloss or note, or isn't only a fence", () => {
    const figure = doc(["[A]{#s1b1}", "", "::: {.figure #f-1 anchor=s1b1}", ":::"]);
    expect(glossInsertPos(figure, 1, "s1b1")).toBe(figure.line(1).to);
    const trailing = doc(["[A]{#s1b1}", "", "::: {.gloss #g-0001 anchor=s1b1}x", ":::"]);
    expect(glossInsertPos(trailing, 1, "s1b1")).toBe(trailing.line(1).to);
    const inline = doc(["[A]{#s1b1}", "x::: {.gloss #g-0001 anchor=s1b1}", "::: {.note}", ":::", ":::"]);
    expect(glossInsertPos(inline, 1, "s1b1")).toBe(inline.line(1).to);
  });

  it("stops at the end of the file", () => {
    const d = doc(["[A]{#s1b1}", "", ""]);
    expect(glossInsertPos(d, 1, "s1b1")).toBe(d.line(1).to);
  });
});
