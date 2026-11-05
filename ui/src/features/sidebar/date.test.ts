import { describe, expect, it } from "vitest";
import { shortDate } from "./date";

// 03-lecture-files.md#front-matter: `date: 2026-10-23`. The sidebar shows it short ("Oct 23").

describe("shortDate", () => {
  it("shows a front-matter date as month and day", () => {
    expect(shortDate("2026-10-23")).toBe("Oct 23");
    expect(shortDate("2026-01-01")).toBe("Jan 1");
    expect(shortDate("2026-12-31")).toBe("Dec 31");
    expect(shortDate("2028-02-29")).toBe("Feb 29");
  });

  it("shows nothing for a date that isn't a real YYYY-MM-DD day", () => {
    for (const bad of [
      "",
      "2026-13-01",
      "2026-00-10",
      "2026-02-30",
      "2027-02-29",
      "2026-10-1",
      "26-10-23",
      "2026-10-23T10:00",
      " 2026-10-23",
      "Oct 23",
    ]) {
      expect(shortDate(bad), bad).toBeNull();
    }
  });
});
