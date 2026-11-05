import { createMemo, type JSX, lazy, Show } from "solid-js";
import type { CourseState } from "../../state/course";
import type { RailState } from "../../state/rail";
import { loadSidebar } from "../sidebar/load";
import { CourseRail } from "./CourseRail";
import { stableRailCourses } from "./known";

// Out of the first-paint chunk (sidebar/load.ts): rendered once a course is open.
const Sidebar = lazy(() => loadSidebar().then((m) => ({ default: m.Sidebar })));

/**
 * The rail column (09-ui.md#layout): the course rail, then the sidebar (the open course's
 * dashboard, lectures, lists and sources, F-036). The rail's `+` opens a folder in the dialog, a
 * course on it opens without one, and its order is saved.
 */
export function RailColumn(props: {
  course: CourseState;
  rail: RailState;
  /** Opens a lecture (its course-relative path) of the course (its path) in the buffer. */
  onOpenLecture: (course: string, path: string) => void;
  /** The lecture in the buffer, highlighted in the list. */
  openLecture: string | null;
  /** Whether the sidebar shows (`␣e` toggles it); the course rail always does. */
  sidebarShown?: boolean | undefined;
}): JSX.Element {
  const toRail = stableRailCourses();
  const courses = createMemo(() => toRail(props.rail.courses()));
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
      {/* Before a course opens the sidebar is empty: only its frame, which the headerbar's toggle names. */}
      <Show when={props.course.course()} fallback={<div id="sidebar" hidden={!(props.sidebarShown ?? true)} />}>
        <Sidebar
          course={props.course.course()}
          shown={props.sidebarShown ?? true}
          onOpenLecture={props.onOpenLecture}
          openLecture={props.openLecture}
        />
      </Show>
    </>
  );
}
