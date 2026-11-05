import { type Accessor, createSignal, onCleanup } from "solid-js";
import { type KnownCourse, listCourses, onCoursesChanged, reorderCourses } from "../core/course";

/** The courses on the course rail, in order (09-ui.md#layout, D-188). */
export interface RailState {
  /** The rail's courses as the core last sent them; empty before `load`. */
  courses: Accessor<KnownCourse[]>;
  /** Why the last read or reorder failed; cleared by the next one that works. */
  error: Accessor<string | null>;
  /** Reads the rail from the core and follows `course:changed` from then on. */
  load: () => Promise<void>;
  /**
   * Shows `paths` as the new order at once and saves it; if the core refuses, the old order comes
   * back with the core's message as the error.
   */
  reorder: (paths: string[]) => Promise<void>;
}

/** Call inside a Solid owner (a component): the event listener goes with it. */
export function createRail(): RailState {
  const [courses, setCourses] = createSignal<KnownCourse[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  let gone = false;
  let stop: (() => void) | undefined;
  onCleanup(() => {
    gone = true;
    stop?.();
  });

  async function load(): Promise<void> {
    if (!stop) {
      try {
        const unlisten = await onCoursesChanged((list) => setCourses(list));
        if (gone) unlisten();
        else stop = unlisten;
      } catch {
        // Without the event the rail still shows what `course_list` and `course_reorder` answer.
      }
    }
    try {
      const result = await listCourses();
      if (result.status === "error") {
        setError(result.error.message);
      } else {
        setCourses(result.data);
        setError(null);
      }
    } catch {
      setError("Lecter could not reach the core to list the courses.");
    }
  }

  async function reorder(paths: string[]): Promise<void> {
    const before = courses();
    const byPath = new Map(before.map((c) => [c.path, c]));
    const moved = paths.map((p) => byPath.get(p)).filter((c): c is KnownCourse => c !== undefined);
    setCourses(moved);
    try {
      const result = await reorderCourses(paths);
      if (result.status === "error") {
        setCourses(before);
        setError(result.error.message);
      } else {
        setCourses(result.data);
        setError(null);
      }
    } catch {
      setCourses(before);
      setError("Lecter could not reach the core to save the order.");
    }
  }

  return { courses, error, load, reorder };
}
