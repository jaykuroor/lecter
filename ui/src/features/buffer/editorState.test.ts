import { describe, expect, it } from "vitest";
import { lectureState } from "./editorState";

describe("a new lecture buffer state", () => {
  it("puts the cursor on the first block's text", () => {
    const state = lectureState("---\nlecter: 1\n---\n\n::: {.slide #s1 n=1}\n## T\n\n[First]{#s1b1}\n:::\n", "x");
    expect(state.selection.main.head).toBe(state.doc.line(8).from + 1);
  });

  it("starts at the top when nothing shows yet", () => {
    expect(lectureState("---\nlecter: 1\n---\n", "x").selection.main.head).toBe(0);
    expect(lectureState("", "x").selection.main.head).toBe(0);
  });
});
