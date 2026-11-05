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
