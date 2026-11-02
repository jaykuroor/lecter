import { type Accessor, createSignal } from "solid-js";
import { type CourseOpened, openCourse } from "../core/course";

/** The open course and the state of opening one. */
export interface CourseState {
  /** The course on screen, or `null` before one is opened. */
  course: Accessor<CourseOpened | null>;
  /** The last open's error message, cleared by the next successful open. */
  error: Accessor<string | null>;
  /** Whether the folder dialog is open; a second open waits for it. */
  busy: Accessor<boolean>;
  /** Asks the core to open a course. A cancelled dialog keeps the current course. */
  open: () => Promise<void>;
}

export function createCourse(): CourseState {
  const [course, setCourse] = createSignal<CourseOpened | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  async function open(): Promise<void> {
    if (busy()) return;
    setBusy(true);
    try {
      const result = await openCourse();
      if (result.status === "error") {
        setError(result.error.message);
      } else if (result.data) {
        setCourse(result.data);
        setError(null);
      }
    } catch {
      setError("Lecter could not reach the core to open the folder.");
    } finally {
      setBusy(false);
    }
  }

  return { course, error, busy, open };
}
