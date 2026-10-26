import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { sampleLecture } from "../../../e2e/mock-core/lectures";
import { lastElement, nthElement, showingPos, stepElements } from "./elements";

const doc = (text: string) => Text.of(text.split("\n"));
const sample = doc(sampleLecture);
// The sample's element lines: five blocks, a gloss line and a note line (lectures.ts).
const ELEMENTS = [14, 16, 23, 25, 28, 32, 39];

describe("moving between elements (10-keymap.md#move-everywhere)", () => {
  it("steps over hidden lines and gaps, one element at a time", () => {
    const down: number[] = [];
    for (let n: number | null = 1; n !== null; n = stepElements(sample, n, 1, 1)) down.push(n);
    expect(down.slice(1)).toEqual(ELEMENTS);
    const up: number[] = [];
    for (let n: number | null = sample.lines; n !== null; n = stepElements(sample, n, -1, 1)) up.push(n);
    expect(up.slice(1)).toEqual([...ELEMENTS].reverse());
  });

  it("takes a count, stopping at the last element there is", () => {
    expect(stepElements(sample, 14, 1, 3)).toBe(25);
    expect(stepElements(sample, 39, -1, 2)).toBe(28);
    expect(stepElements(sample, 14, 1, 99)).toBe(39);
    expect(stepElements(sample, 25, -1, 99)).toBe(14);
    expect(stepElements(sample, 14, 1, 0)).toBe(16);
  });

  it("has nowhere to go past the first or last element", () => {
    expect(stepElements(sample, 39, 1, 1)).toBeNull();
    expect(stepElements(sample, 14, -1, 1)).toBeNull();
    expect(stepElements(doc("---\na: 1\n---\n\n:::"), 1, 1, 1)).toBeNull();
  });

  it("finds the first, nth and last element", () => {
    expect(nthElement(sample, 1)).toBe(14);
    expect(nthElement(sample, 4)).toBe(25);
    expect(nthElement(sample, 50)).toBe(39);
    expect(lastElement(sample)).toBe(39);
    expect(lastElement(doc(":::"))).toBeNull();
    expect(nthElement(doc("one line"), 1)).toBe(1);
    expect(lastElement(doc("a\nb"))).toBe(2);
  });
});

describe("keeping the cursor on text that shows", () => {
  const l14 = sample.line(14);
  const l16 = sample.line(16);
  const l23 = sample.line(23);
  const text14 = { from: l14.from + 1, to: l14.from + l14.text.indexOf("]{#s1b1") };

  it("keeps a block's cursor between its hidden brackets", () => {
    expect(showingPos(sample, l14.from, 1)).toBe(text14.from);
    expect(showingPos(sample, l14.from, -1)).toBe(text14.from);
    expect(showingPos(sample, l14.to, 1)).toBe(text14.to);
    expect(showingPos(sample, text14.to + 2, -1)).toBe(text14.to);
    expect(showingPos(sample, text14.from + 5, 1)).toBe(text14.from + 5);
    expect(showingPos(sample, text14.to, 1)).toBe(text14.to);
  });

  it("moves a cursor off a hidden line to the next element in its direction", () => {
    // Line 18 is a closing fence, line 20 the next slide's fence, line 21 its title.
    expect(showingPos(sample, sample.line(18).from, 1)).toBe(l23.from + 1);
    expect(showingPos(sample, sample.line(21).from + 2, 1)).toBe(l23.from + 1);
    expect(showingPos(sample, sample.line(18).from, -1)).toBe(l16.from + l16.text.indexOf("]{#s1b2"));
    // The front matter: going up finds nothing, so the cursor goes to the first element instead.
    expect(showingPos(sample, 0, -1)).toBe(text14.from);
    expect(showingPos(sample, 0, 1)).toBe(text14.from);
    // Past the last element: down finds nothing, so it goes back to the last one's end.
    const l39 = sample.line(39);
    expect(showingPos(sample, sample.line(41).from, 1)).toBe(l39.from + l39.text.indexOf("]{#s3b1"));
  });

  it("leaves gaps, text lines and buffers without elements alone", () => {
    expect(showingPos(sample, sample.line(15).from, 1)).toBe(sample.line(15).from);
    expect(showingPos(sample, sample.line(28).from + 3, -1)).toBe(sample.line(28).from + 3);
    const bare = doc("---\na: 1\n---");
    expect(showingPos(bare, 4, 1)).toBe(4);
  });
});
