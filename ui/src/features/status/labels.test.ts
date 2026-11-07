import { describe, expect, it } from "vitest";
import { costLabel, lectureId, MODE_LABEL, placeLabel, slideLabel, statusMode } from "./labels";

// 09-ui.md#layout: the status line shows mode, course/lecture, slide, active model, lecture cost and
// a job spinner ("NORMAL · stat311/L07 · slide 3 · Claude Haiku · $0.04").

describe("statusMode: the mode the status line shows", () => {
  it("is Vim's mode while no command line is open", () => {
    expect(statusMode("normal", false)).toBe("normal");
    expect(statusMode("insert", false)).toBe("insert");
    expect(statusMode("visual", false)).toBe("visual");
  });

  it("is COMMAND while a command line is open, whatever Vim's mode", () => {
    expect(statusMode("normal", true)).toBe("command");
    expect(statusMode("visual", true)).toBe("command");
    expect(statusMode("insert", true)).toBe("command");
  });

  it("counts Vim's replace mode as insert (the status line has four modes)", () => {
    expect(statusMode("replace", false)).toBe("insert");
  });

  it("names each mode as Vim does", () => {
    expect(MODE_LABEL).toEqual({ normal: "NORMAL", insert: "INSERT", visual: "VISUAL", command: "COMMAND" });
  });
});

describe("lectureId: a lecture file's short name", () => {
  it("drops the date and the title words", () => {
    expect(lectureId("2026-10-23-l07-covariance.md")).toBe("l07");
  });

  it("keeps the leading number of a numbered file", () => {
    expect(lectureId("01-taking-notes.md")).toBe("01");
  });

  it("keeps a one-word name whole, without .md", () => {
    expect(lectureId("intro.md")).toBe("intro");
    expect(lectureId("week3")).toBe("week3");
  });

  it("keeps a date-only name rather than showing nothing", () => {
    expect(lectureId("2026-10-23.md")).toBe("2026-10-23");
  });

  it("drops only a leading date followed by a dash, and only a final .md", () => {
    // A date later in the name is a word like any other.
    expect(lectureId("l07-2026-10-23.md")).toBe("l07");
    // Digits that only start like a date are no date.
    expect(lectureId("2026-10-23b-review.md")).toBe("2026");
    expect(lectureId("intro.mdx")).toBe("intro.mdx");
  });
});

describe("placeLabel: the course/lecture segment", () => {
  it("is course/lecture", () => {
    expect(placeLabel("STAT311", "2026-10-23-l07-covariance.md")).toBe("STAT311/l07");
  });

  it("is the course alone before a lecture is open", () => {
    expect(placeLabel("lecter101", null)).toBe("lecter101");
  });

  it("is nothing before a course is open", () => {
    expect(placeLabel(null, null)).toBeNull();
    expect(placeLabel(null, "01-taking-notes.md")).toBeNull();
  });
});

describe("costLabel: the lecture cost in dollars", () => {
  it("shows cents", () => {
    expect(costLabel(0.04)).toBe("$0.04");
    expect(costLabel(0)).toBe("$0.00");
    expect(costLabel(12.5)).toBe("$12.50");
  });

  it("never shows a spend under a cent as nothing", () => {
    expect(costLabel(0.001)).toBe("<$0.01");
    expect(costLabel(0.0049)).toBe("<$0.01");
    expect(costLabel(0.005)).toBe("$0.01");
  });

  it("shows nothing for an unknown or impossible cost", () => {
    expect(costLabel(null)).toBeNull();
    expect(costLabel(-1)).toBeNull();
    expect(costLabel(Number.NaN)).toBeNull();
    expect(costLabel(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("slideLabel: the slide segment", () => {
  it("is n/N on screen and in words for assistive tools", () => {
    expect(slideLabel({ n: 3, total: 6 })).toEqual({ text: "3/6", words: "Slide 3 of 6" });
  });
});
