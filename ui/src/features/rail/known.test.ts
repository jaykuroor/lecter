import { describe, expect, it } from "vitest";
import type { KnownCourse } from "../../core/bindings";
import { railCourse, stableRailCourses } from "./known";

describe("railCourse", () => {
  it("keeps a text icon, the colour and whether the folder is missing", () => {
    expect(railCourse({ path: "/c/s", name: "Statistics", icon: "St", color: "#26a269", missing: true })).toEqual({
      path: "/c/s",
      name: "Statistics",
      icon: { kind: "text", text: "St" },
      color: "#26a269",
      missing: true,
    });
  });

  it("shows the first letter for an image icon until course images are served (F-063)", () => {
    const got = railCourse({
      path: "/c/b",
      name: "Biology",
      icon: ".lecter/icon.png",
      color: "#3584e4",
      missing: false,
    });
    expect(got.icon).toEqual({ kind: "text", text: "" });
    // A text icon that only looks like a folder name is still text.
    expect(railCourse({ path: "/c/b", name: "B", icon: ".lect", color: "#3584e4", missing: false }).icon).toEqual({
      kind: "text",
      text: ".lect",
    });
  });
});

describe("stableRailCourses", () => {
  const k = (path: string, extra: Partial<KnownCourse> = {}): KnownCourse => ({
    path,
    name: path.slice(1),
    icon: "X",
    color: "#3584e4",
    missing: false,
    ...extra,
  });

  it("hands back the same object for a course that looks the same, in the new order", () => {
    const map = stableRailCourses();
    const [a, b] = map([k("/a"), k("/b")]);
    const again = map([k("/b"), k("/a")]);
    expect(again[0]).toBe(b);
    expect(again[1]).toBe(a);
  });

  it("makes a new object for a course whose name, icon, colour or folder changed", () => {
    for (const change of [{ name: "New" }, { icon: "Y" }, { color: "#26a269" }, { missing: true }]) {
      const map = stableRailCourses();
      const [a] = map([k("/a")]);
      const [changed] = map([k("/a", change)]);
      expect(changed, JSON.stringify(change)).not.toBe(a);
      expect(changed).toEqual(railCourse(k("/a", change)));
    }
  });

  it("forgets a course that left the list", () => {
    const map = stableRailCourses();
    const [a] = map([k("/a")]);
    map([k("/b")]);
    expect(map([k("/a")])[0]).not.toBe(a);
  });
});
