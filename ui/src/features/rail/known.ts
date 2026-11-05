import type { KnownCourse } from "../../core/course";
import type { RailCourse } from "./CourseRail";

/**
 * A course from `course_list` as the rail shows it. An image icon (`.lecter/icon.png`, D-185)
 * can't be shown until the core serves course images over `lecter://` (F-063): the rail shows the
 * name's first letter for it meanwhile.
 */
export function railCourse(known: KnownCourse): RailCourse {
  const image = known.icon.startsWith(".lecter/");
  return {
    path: known.path,
    name: known.name,
    icon: { kind: "text", text: image ? "" : known.icon },
    color: known.color,
    missing: known.missing,
  };
}

/**
 * Maps each list from the core to rail courses, handing back the same object for a course that
 * looks the same as last time. The rail's rows are keyed by object, so a list that only repeats
 * what is on screen (the core's answer to a reorder, `course:changed`) redraws nothing, and the
 * row the user is moving keeps its focus.
 */
export function stableRailCourses(): (list: KnownCourse[]) => RailCourse[] {
  let last = new Map<string, RailCourse>();
  return (list) => {
    const next = new Map<string, RailCourse>();
    const courses = list.map((known) => {
      const fresh = railCourse(known);
      const old = last.get(known.path);
      const kept = old && same(old, fresh) ? old : fresh;
      next.set(known.path, kept);
      return kept;
    });
    last = next;
    return courses;
  };
}

function same(a: RailCourse, b: RailCourse): boolean {
  const icon = (c: RailCourse) => (c.icon.kind === "text" ? `t:${c.icon.text}` : `i:${c.icon.src}`);
  return a.name === b.name && a.color === b.color && a.missing === b.missing && icon(a) === icon(b);
}
