import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { findFigures, isFigureFence } from "./find";

const doc = (lines: string[]) => Text.of(lines);

const GLOSS = '::: {.gloss #g-0001 kind=ask key=a anchor=s1b1 model="sample" by=ai}';

describe("finding figures", () => {
  it("finds an fnplot block inside a gloss, with its spec and where it ends", () => {
    const d = doc([
      '::: {.slide #s1 n=1 title="T"}',
      "[A block.]{#s1b1}",
      "",
      GLOSS,
      "**you asked:** plot it",
      "",
      "Here:",
      "```fnplot",
      '{"type": "fnplot",',
      ' "exprs": ["x^2"]}',
      "```",
      ":::",
      ":::",
    ]);
    const [fig, ...rest] = findFigures(d);
    expect(rest).toEqual([]);
    expect(fig?.source).toBe('{"type": "fnplot",\n "exprs": ["x^2"]}');
    expect(fig?.from).toBe(d.line(8).from);
    expect(fig?.to).toBe(d.line(11).to);
  });

  it("finds each figure of each gloss, in order", () => {
    const d = doc([
      GLOSS,
      "```fnplot",
      "1",
      "```",
      "```fnplot",
      "2",
      "```",
      ":::",
      GLOSS,
      "``` fnplot ",
      "3",
      "``` ",
      ":::",
    ]);
    expect(findFigures(d).map((f) => f.source)).toEqual(["1", "2", "3"]);
  });

  it("takes off the backslash the gloss puts before [ and ::: lines", () => {
    const d = doc([GLOSS, "```fnplot", "{", '"x":', "\\[-1, 1],", "\\:::", "\\other", "```", ":::"]);
    expect(findFigures(d)[0]?.source).toBe('{\n"x":\n[-1, 1],\n:::\n\\other');
  });

  it("ignores fnplot blocks outside glosses, other code blocks and unclosed ones", () => {
    expect(findFigures(doc(["```fnplot", "1", "```"]))).toEqual([]);
    expect(findFigures(doc(["::: {.note #n-1}", "```fnplot", "1", "```", ":::"]))).toEqual([]);
    expect(findFigures(doc([GLOSS, "```json", "1", "```", ":::"]))).toEqual([]);
    expect(findFigures(doc([GLOSS, "```fnplotx", "1", "```", ":::"]))).toEqual([]);
    // The gloss ends before the block does: no figure, and none after the gloss either.
    expect(findFigures(doc([GLOSS, "```fnplot", "1", ":::", "```fnplot", "2", "```"]))).toEqual([]);
    // A gloss that never closes still holds its figure.
    expect(findFigures(doc([GLOSS, "```fnplot", "1", "```"])).map((f) => f.source)).toEqual(["1"]);
  });

  it("knows the lines that can move figures", () => {
    expect(isFigureFence(":::")).toBe(true);
    expect(isFigureFence(GLOSS)).toBe(true);
    expect(isFigureFence("```fnplot")).toBe(true);
    expect(isFigureFence("```")).toBe(true);
    expect(isFigureFence("plain text")).toBe(false);
    expect(isFigureFence(" ```")).toBe(false);
    expect(isFigureFence("``")).toBe(false);
  });
});
