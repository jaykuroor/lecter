import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { sampleLecture } from "../../../e2e/mock-core/lectures";
import {
  blockSpan,
  frontMatterEnd,
  frontMatterSlides,
  isElement,
  isHidden,
  lineKind,
  parseAttrs,
  slideFence,
  sourceLabel,
  visibleRange,
} from "./syntax";

const doc = (text: string) => Text.of(text.split("\n"));
const sample = doc(sampleLecture);

describe("lecture line structure (03-lecture-files.md#body)", () => {
  it("reads Pandoc attributes: id, classes, bare and quoted values", () => {
    expect(parseAttrs('.slide #s3 n=3 src="A3" title="Two words" .flag')).toEqual({
      id: "s3",
      classes: ["slide", "flag"],
      values: { n: "3", src: "A3", title: "Two words" },
    });
    expect(parseAttrs("")).toEqual({ id: "", classes: [], values: {} });
    expect(parseAttrs('title=""').values).toEqual({ title: "" });
  });

  it("recognises a slide's opening fence and nothing else", () => {
    expect(slideFence('::: {.slide #s3 n=3 src="A3" title="Properties"}')).toEqual({
      id: "s3",
      n: 3,
      title: "Properties",
      src: "A3",
      flagged: false,
    });
    expect(slideFence("::: {.slide #s4 n=4 .flag}")).toEqual({ id: "s4", n: 4, title: "", src: "", flagged: true });
    expect(slideFence("::: {.slide #s5 n=five}")?.n).toBe(0);
    expect(slideFence("::: {.slide #s5 n=-2}")?.n).toBe(0);
    expect(slideFence("::: {.slide #s5 n=2.5}")?.n).toBe(0);
    expect(slideFence("::: {.gloss #g-7f3a kind=steps}")).toBeNull();
    expect(slideFence(":::")).toBeNull();
    expect(slideFence("::: {.slide #s1} trailing")).toBeNull();
    expect(slideFence("text ::: {.slide #s1}")).toBeNull();
  });

  it("finds a block span's text between its hidden brackets and attributes", () => {
    const line = "[A ]{#tricky} text]{#s3b2 .flag}";
    expect(blockSpan(line)).toEqual({ id: "s3b2", flagged: true, from: 1, to: line.indexOf("]{#s3b2") });
    expect(blockSpan("[Plain]{#s12b30}")).toEqual({ id: "s12b30", flagged: false, from: 1, to: 6 });
    expect(blockSpan("[]{#s1b1}")).toEqual({ id: "s1b1", flagged: false, from: 1, to: 1 });
    expect(blockSpan("[Text]{#s1b1}  ")?.to).toBe(5);
    for (const notBlock of [
      "[Text]{#g-7f3a}",
      "[Text]{#s1}",
      "Text]{#s1b1}",
      "[Text]{#s1b1",
      " [Text]{#s1b1}",
      "[Text]",
    ]) {
      expect(blockSpan(notBlock), notBlock).toBeNull();
    }
  });

  it("finds the front matter and its slide files", () => {
    expect(frontMatterEnd(sample)).toBe(9);
    expect(frontMatterSlides(sample, 9)).toEqual(["slides/07-covariance.pdf", "slides/07b-examples.pptx"]);
    expect(frontMatterEnd(doc("---\ntitle: x\n...\nbody"))).toBe(3);
    expect(frontMatterEnd(doc("no front matter\n---"))).toBe(0);
    expect(frontMatterEnd(doc("---\nnever closed"))).toBe(0);
    expect(frontMatterEnd(doc("---"))).toBe(0);
    const quoted = doc('---\nslides:\n  - "slides/a b.pdf"\n- slides/c.pdf\ndate: 1\n  - not/a/slide.pdf\n---');
    expect(frontMatterSlides(quoted, 7)).toEqual(["slides/a b.pdf", "slides/c.pdf"]);
    expect(frontMatterSlides(doc("---\nslides: []\n---"), 3)).toEqual([]);
  });

  it("gives every line of a lecture its role", () => {
    const kinds = Array.from({ length: sample.lines }, (_, i) => lineKind(sample, i + 1, 9));
    expect(kinds.slice(0, 9).every((k) => k === "front-matter")).toBe(true);
    expect(kinds.slice(9)).toEqual([
      "blank", // 10
      "slide",
      "title",
      "blank",
      "block", // 14
      "blank",
      "block",
      "blank",
      "fence", // 18
      "blank",
      "slide", // 20
      "title",
      "blank",
      "block",
      "blank",
      "block", // 25
      "blank",
      "fence",
      "text", // 28 gloss body
      "fence",
      "blank", // 30
      "fence",
      "text",
      "fence",
      "fence",
      "blank", // 35
      "slide",
      "title",
      "blank",
      "block",
      "blank", // 40
      "fence",
      "blank",
    ]);
  });

  it("treats `## ` as a title only right under a slide fence", () => {
    const d = doc("## Not a title\n::: {.slide #s1 n=1}\n## Title\n## Second heading\n   ");
    expect([1, 2, 3, 4, 5].map((n) => lineKind(d, n, 0))).toEqual(["text", "slide", "title", "text", "blank"]);
  });

  it("shows blocks and text, gaps for blank lines, hides the rest", () => {
    expect(["block", "text"].map((k) => isElement(k as "block"))).toEqual([true, true]);
    expect(["blank", "slide", "title", "fence", "front-matter"].some((k) => isElement(k as "block"))).toBe(false);
    expect(["slide", "title", "fence", "front-matter"].every((k) => isHidden(k as "block"))).toBe(true);
    expect(["block", "text", "blank"].some((k) => isHidden(k as "block"))).toBe(false);
  });

  it("knows where an element line's visible text is", () => {
    const line14 = sample.line(14);
    expect(visibleRange(sample, 14)).toEqual({
      from: line14.from + 1,
      to: line14.from + line14.text.indexOf("]{#s1b1"),
    });
    const line28 = sample.line(28);
    expect(visibleRange(sample, 28)).toEqual({ from: line28.from, to: line28.to });
  });

  it("labels a slide's source from the front matter's files", () => {
    const files = ["slides/07-covariance.pdf", "07b-examples.pptx"];
    expect(sourceLabel("A3", files)).toBe("07-covariance.pdf · slide 3");
    expect(sourceLabel("B12", files)).toBe("07b-examples.pptx · slide 12");
    expect(sourceLabel("C1", files)).toBe("C1");
    expect(sourceLabel("board", files)).toBe("board");
    expect(sourceLabel("a3", files)).toBe("a3");
    expect(sourceLabel("A3x", files)).toBe("A3x");
    expect(sourceLabel("", [])).toBe("");
  });
});
