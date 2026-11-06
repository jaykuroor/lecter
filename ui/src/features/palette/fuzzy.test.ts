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
