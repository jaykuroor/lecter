import { describe, expect, it } from "vitest";
import { fuzzyFilter, fuzzyMatch } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("matches the query's letters in order, in any case, and says where", () => {
    expect(fuzzyMatch("cov", "2026-10-23-L07-Covariance.md")?.hits).toEqual([15, 16, 17]);
    expect(fuzzyMatch("L07", "2026-10-23-l07-covariance.md")?.hits).toEqual([11, 12, 13]);
  });

  it("refuses text that lacks a letter, or has them out of order", () => {
    expect(fuzzyMatch("xyz", "Covariance")).toBeNull();
    expect(fuzzyMatch("vc", "Cov")).toBeNull();
    // One letter more than the text has.
    expect(fuzzyMatch("covv", "cov")).toBeNull();
  });

  it("ignores spaces in the query, and an empty query matches everything with no hits", () => {
    expect(fuzzyMatch("open sl", "Open slides")?.hits).toEqual([0, 1, 2, 3, 5, 6]);
    expect(fuzzyMatch("", "Anything")).toEqual({ score: 0, hits: [] });
    expect(fuzzyMatch("   ", "Anything")).toEqual({ score: 0, hits: [] });
  });

  it("prefers the letters together and at word starts over the first ones it finds", () => {
    // Greedy would take the c of "calc", o of "of", v of "variance"; the run is in "covariance".
    expect(fuzzyMatch("cov", "calc of covariance")?.hits).toEqual([8, 9, 10]);
    // "st" takes the start of "Statistics" over the earlier run inside "first".
    expect(fuzzyMatch("st", "first Statistics")?.hits).toEqual([6, 7]);
  });

  it("scores a run above scattered letters, and a word start above a letter inside a word", () => {
    const run = fuzzyMatch("cov", "covariance")?.score as number;
    const scattered = fuzzyMatch("cov", "c-o-v")?.score as number;
    const inside = fuzzyMatch("var", "covariance")?.score as number;
    const start = fuzzyMatch("var", "co variance")?.score as number;
    expect(run).toBeGreaterThan(scattered);
    expect(start).toBeGreaterThan(inside);
    // A shorter gap beats a longer one.
    expect(fuzzyMatch("ab", "a-b")?.score as number).toBeGreaterThan(fuzzyMatch("ab", "a---b")?.score as number);
  });

  it("counts a capital after a small letter as a word start", () => {
    expect(fuzzyMatch("os", "officeHours openSlides")?.hits).toEqual([12, 16]);
  });
});

describe("fuzzyMatch's score (16 a letter; +8 a word start, +7 a camel hump; a run keeps its first bonus, at least 4; a gap of g letters costs 3 + g - 1)", () => {
  it("adds up a run at a word start", () => {
    expect(fuzzyMatch("cov", "covariance")).toEqual({ score: 72, hits: [0, 1, 2] });
    expect(fuzzyMatch("var", "covariance")).toEqual({ score: 56, hits: [2, 3, 4] });
  });

  it("charges for gaps by their length", () => {
    expect(fuzzyMatch("cov", "c-o-v")).toEqual({ score: 66, hits: [0, 2, 4] });
    expect(fuzzyMatch("ab", "a-b")?.score).toBe(45);
    expect(fuzzyMatch("ab", "a---b")?.score).toBe(43);
    expect(fuzzyMatch("ab", "axxb")?.score).toBe(36);
  });

  it("gives a capital after a small letter the camel bonus, and no other capital", () => {
    expect(fuzzyMatch("s", "openSlides")?.score).toBe(23);
    expect(fuzzyMatch("s", "OPENSLIDES")?.score).toBe(16);
    expect(fuzzyMatch("s", "opens")?.score).toBe(16);
    expect(fuzzyMatch("l", "openSlides")?.score).toBe(16);
    expect(fuzzyMatch("7", "l07")?.score).toBe(16);
  });

  it("prefers a later run to a gap from a word start when it scores more", () => {
    // c0 + e9 would be 24 + (16 - 10) = 30; c8 e9 is 16 + 20 = 36.
    expect(fuzzyMatch("ce", "covariance")).toEqual({ score: 36, hits: [8, 9] });
  });

  it("keeps letters together on a tie with a gap, and the earliest end on a tie of ends", () => {
    // a0…b3 (24 + 16 - 4) and a2 b3 (16 + 20) both score 36.
    expect(fuzzyMatch("ab", "axab")).toEqual({ score: 36, hits: [2, 3] });
    expect(fuzzyMatch("a", "a a")).toEqual({ score: 24, hits: [0] });
  });

  it("reads only the first 256 units of a text and a query", () => {
    expect(fuzzyMatch("z", `${"a".repeat(300)}z`)).toBeNull();
    expect(fuzzyMatch("a".repeat(300), "a".repeat(300))?.hits).toHaveLength(256);
  });
});

describe("fuzzyFilter", () => {
  const items = ["Calculus II", "Covariance", "Physics", "Course details"];

  it("keeps the matches, best first, and the list's order among equals", () => {
    expect(fuzzyFilter(items, "co", (s) => s).map((m) => m.item)).toEqual(["Covariance", "Course details"]);
    // "Physics" has its c inside a word: last.
    expect(fuzzyFilter(items, "c", (s) => s).map((m) => m.item)).toEqual([
      "Calculus II",
      "Covariance",
      "Course details",
      "Physics",
    ]);
  });

  it("keeps everything in order for an empty query", () => {
    expect(fuzzyFilter(items, "", (s) => s).map((m) => m.item)).toEqual(items);
  });

  it("ranks a tight match above a loose one wherever it is in the list", () => {
    const list = ["c o v", "lecture covered", "lecture seven: covariance"];
    expect(fuzzyFilter(list, "cov", (s) => s).map((m) => m.item)).toEqual([
      "lecture covered",
      "lecture seven: covariance",
      "c o v",
    ]);
  });

  it("finds nothing when nothing matches", () => {
    expect(fuzzyFilter(items, "zzz", (s) => s)).toEqual([]);
  });
});
