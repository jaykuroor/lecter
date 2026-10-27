// F-023 criterion 3: a gloss goes under its block in the lecture file (03-lecture-files.md#body).
import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { blockLine, glossInsertPos } from "./place";

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

describe("blockLine", () => {
  it("finds a block's line by its exact id", () => {
    const d = doc(LECTURE);
    expect(blockLine(d, "s3b1")).toBe(4);
    expect(blockLine(d, "s3b2")).toBe(6);
    expect(blockLine(d, "s3b")).toBeNull();
    expect(blockLine(d, "s3b3")).toBeNull();
    // Text that mentions an id isn't the block.
    expect(blockLine(doc(["see {#s1b1}", "x[y]{#s1b1}"]), "s1b1")).toBeNull();
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
    expect(blockLine(d, "s2b1")).toBe(3);
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
      ":::x is not a fence",
      "text ::: is not a fence",
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
