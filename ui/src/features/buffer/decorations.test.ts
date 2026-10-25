import { EditorState, Text } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { sampleLecture } from "../../../e2e/mock-core/lectures";
import { buildDecorations, type Heading, lectureDecorations, SlideHeading } from "./decorations";

const doc = (text: string) => Text.of(text.split("\n"));
const sample = doc(sampleLecture);

/** One decoration, readable: its line span and what it does. */
type Entry = string;

/** The decorations as `<from line>-<to line> <what>` strings, in document order. */
function dump(set: DecorationSet, d: Text): Entry[] {
  const out: Entry[] = [];
  set.between(0, d.length, (from, to, value) => {
    const spec = value.spec as { class?: string; widget?: unknown; block?: boolean };
    const where = `${d.lineAt(from).number}-${d.lineAt(to).number}`;
    if (spec.widget instanceof SlideHeading) out.push(`${where} heading ${JSON.stringify(spec.widget.heading)}`);
    else if (spec.class) out.push(`${where} line ${spec.class}`);
    else if (spec.block) out.push(`${where} hide lines`);
    else out.push(`${where} hide ${d.sliceString(from, to)}`);
  });
  return out;
}

const heading = (h: Heading) => JSON.stringify(h);

describe("lecture decorations (components.md#slide-heading, #block)", () => {
  it("hides structure, turns fences into slide headings and blocks into blocks", () => {
    const entries = dump(buildDecorations(sample), sample);
    expect(entries).toEqual([
      "1-9 hide lines",
      "10-10 line cm-gap",
      `11-12 heading ${heading({ n: 1, total: 3, title: "Covariance", source: "07-covariance.pdf · slide 1", flagged: false })}`,
      "13-13 line cm-gap",
      "14-14 line cm-block",
      "14-14 hide [",
      "14-14 hide ]{#s1b1}",
      "15-15 line cm-gap",
      "16-16 line cm-block",
      "16-16 hide [",
      "16-16 hide ]{#s1b2}",
      "17-17 line cm-gap",
      "18-18 hide lines",
      "19-19 line cm-gap",
      `20-21 heading ${heading({ n: 2, total: 3, title: "Properties", source: "07-covariance.pdf · slide 2", flagged: true })}`,
      "22-22 line cm-gap",
      "23-23 line cm-block",
      "23-23 hide [",
      "23-23 hide ]{#s2b1}",
      "24-24 line cm-gap",
      "25-25 line cm-block cm-block-flagged",
      "25-25 hide [",
      "25-25 hide ]{#s2b2 .flag}",
      "26-26 line cm-gap",
      "27-27 hide lines",
      "28-28 line cm-text",
      "29-29 hide lines",
      "30-30 line cm-gap",
      "31-31 hide lines",
      "32-32 line cm-text",
      "33-33 hide lines",
      "34-34 hide lines",
      "35-35 line cm-gap",
      `36-37 heading ${heading({ n: 3, total: 3, title: "Worked example", source: "07b-examples.pptx · slide 1", flagged: false })}`,
      "38-38 line cm-gap",
      "39-39 line cm-block",
      "39-39 hide [",
      "39-39 hide ]{#s3b1}",
      "40-40 line cm-gap",
      "41-41 hide lines",
      "42-42 line cm-gap",
    ]);
  });

  it("takes a heading's title from the `## ` line and its number from the order when the fence has none", () => {
    const d = doc("::: {.slide #s1}\n## From the line\n[A]{#s1b1}\n:::\n::: {.slide #s2}\n[B]{#s2b1}\n:::");
    const headings = dump(buildDecorations(d), d).filter((e) => e.includes("heading"));
    expect(headings).toEqual([
      `1-2 heading ${heading({ n: 1, total: 2, title: "From the line", source: "", flagged: false })}`,
      `5-5 heading ${heading({ n: 2, total: 2, title: "", source: "", flagged: false })}`,
    ]);
  });

  it("renders a heading as gutter label, title and source", () => {
    const h = new SlideHeading({ n: 2, total: 12, title: "Properties", source: "07.pdf · slide 2", flagged: true });
    const el = h.toDOM();
    expect(el.className).toBe("slide-heading slide-heading-flagged");
    expect([...el.querySelectorAll("div")].map((d) => `${d.className}: ${d.textContent}`)).toEqual([
      "slide-heading-label: ⚑ Slide 2 / 12",
      "slide-heading-main: Properties07.pdf · slide 2",
      "slide-heading-title: Properties",
      "slide-heading-source: 07.pdf · slide 2",
    ]);
    const plain = new SlideHeading({ n: 1, total: 1, title: "T", source: "", flagged: false }).toDOM();
    expect(plain.className).toBe("slide-heading");
    expect(plain.querySelector(".slide-heading-label")?.textContent).toBe("Slide 1 / 1");
    expect(plain.querySelector(".slide-heading-source")).toBeNull();
    expect(h.ignoreEvent()).toBe(false);
  });

  it("compares headings by everything they show", () => {
    const base: Heading = { n: 1, total: 3, title: "T", source: "S", flagged: false };
    const same = new SlideHeading(base);
    expect(same.eq(new SlideHeading({ ...base }))).toBe(true);
    for (const change of [{ n: 2 }, { total: 4 }, { title: "U" }, { source: "R" }, { flagged: true }]) {
      expect(same.eq(new SlideHeading({ ...base, ...change })), JSON.stringify(change)).toBe(false);
    }
  });
});

describe("decorations after edits", () => {
  const state = () => EditorState.create({ doc: sampleLecture, extensions: lectureDecorations });
  const fresh = (s: EditorState) => dump(buildDecorations(s.doc), s.doc);
  const live = (s: EditorState) => dump(s.field(lectureDecorations), s.doc);

  it("rescans only the typed lines and ends where a full build would", () => {
    const s0 = state();
    const before = s0.field(lectureDecorations);
    const at = s0.doc.line(14).from + 1;
    const s1 = s0.update({ changes: { from: at, insert: "Typed " } }).state;
    expect(live(s1)).toEqual(fresh(s1));
    // The heading widgets far from the edit are the same objects: nothing was rebuilt.
    const widgets = (set: DecorationSet) => {
      const out: unknown[] = [];
      set.between(0, s1.doc.length, (_f, _t, v) => {
        if (v.spec.widget) out.push(v.spec.widget);
      });
      return out;
    };
    expect(widgets(s1.field(lectureDecorations))).toEqual(widgets(before));
    expect(widgets(s1.field(lectureDecorations))[2]).toBe(widgets(before)[2]);
  });

  it("turns a typed line into a block or plain text as its syntax changes", () => {
    const s0 = state();
    const l28 = s0.doc.line(28);
    const s1 = s0.update({ changes: { from: l28.from, to: l28.to, insert: "[New block]{#s2b3}" } }).state;
    expect(live(s1)).toEqual(fresh(s1));
    expect(live(s1)).toContain("28-28 line cm-block");
    const l14 = s1.doc.line(14);
    const s2 = s1.update({ changes: { from: l14.to - 1, to: l14.to } }).state;
    expect(live(s2)).toEqual(fresh(s2));
    expect(live(s2)).toContain("14-14 line cm-text");
  });

  it("renumbers every heading when a slide fence goes or comes", () => {
    const s0 = state();
    const fence = s0.doc.line(20);
    const s1 = s0.update({ changes: { from: fence.from, to: fence.to, insert: "Not a fence any more" } }).state;
    expect(live(s1)).toEqual(fresh(s1));
    expect(
      live(s1)
        .filter((e) => e.includes("heading"))
        .map((e) => JSON.parse(e.slice(e.indexOf("{"))).total),
    ).toEqual([2, 2]);
    const s2 = s1.update({
      changes: { from: s1.doc.line(20).from, insert: '::: {.slide #s9 n=9 title="Back"}\n' },
    }).state;
    expect(live(s2)).toEqual(fresh(s2));
    expect(live(s2).filter((e) => e.includes("heading"))).toHaveLength(3);
  });

  it("rebuilds when the front matter changes the slide files", () => {
    const s0 = state();
    const l7 = s0.doc.line(7);
    const s1 = s0.update({ changes: { from: l7.from, to: l7.to, insert: "  - slides/renamed.pdf" } }).state;
    expect(live(s1)).toEqual(fresh(s1));
    expect(live(s1).some((e) => e.includes("renamed.pdf · slide 1"))).toBe(true);
  });

  it("keeps the set when only the selection moves", () => {
    const s0 = state();
    const s1 = s0.update({ selection: { anchor: 400 } }).state;
    expect(s1.field(lectureDecorations)).toBe(s0.field(lectureDecorations));
  });
});
