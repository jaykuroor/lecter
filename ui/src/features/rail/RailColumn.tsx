import { createMemo, type JSX } from "solid-js";
import type { CourseState } from "../../state/course";
import type { RailState } from "../../state/rail";
import { CoursePanel } from "../course/CoursePanel";
import { CourseRail } from "./CourseRail";
import { railCourse } from "./known";

/**
 * The rail column (09-ui.md#layout): the course rail, then the open course's files. The rail's
 * `+` opens a folder in the dialog, a course on it opens without one, and its order is saved.
 */
export function RailColumn(props: {
  course: CourseState;
  rail: RailState;
  /** Opens a lecture (its course-relative path) of the course (its path) in the buffer. */
  onOpenLecture: (course: string, path: string) => void;
  /** The lecture in the buffer, highlighted in the list. */
  openLecture: string | null;
}): JSX.Element {
  const courses = createMemo(() => props.rail.courses().map(railCourse));
  return (
    <>
      <CourseRail
        courses={courses()}
        current={props.course.course()?.path ?? null}
        onSelect={(path) => void props.course.switchTo(path)}
        onReorder={(paths) => void props.rail.reorder(paths)}
        onAdd={() => void props.course.open()}
        busy={props.course.busy()}
        error={props.course.error() ?? props.rail.error()}
      />
      <CoursePanel state={props.course} onOpenLecture={props.onOpenLecture} openLecture={props.openLecture} />
    </>
  );
}
