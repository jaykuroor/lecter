import { type Accessor, createSignal } from "solid-js";
import { answerTrust, type CourseOpened, openCourse, type TrustChoice } from "../core/course";

/** The open course and the state of opening one. */
export interface CourseState {
  /** The course on screen, or `null` before one is opened. */
  course: Accessor<CourseOpened | null>;
  /** The last open's or answer's error message, cleared by the next successful one. */
  error: Accessor<string | null>;
  /** Whether the folder dialog is open or an answer is being saved; a second call waits for it. */
  busy: Accessor<boolean>;
  /** Asks the core to open a course. A cancelled dialog keeps the current course. */
  open: () => Promise<void>;
  /**
   * Answers the open course's trust screen (02-course-folder.md#trust). The core's answer replaces
   * the course's trust and screen: it asks again if the course's AI files changed meanwhile.
   */
  answer: (choice: TrustChoice) => Promise<void>;
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

  async function answer(choice: TrustChoice): Promise<void> {
    const current = course();
    if (busy() || !current) return;
    setBusy(true);
    try {
      const result = await answerTrust(current.path, choice);
      if (result.status === "error") {
        setError(result.error.message);
      } else if (course()?.path === current.path) {
        setCourse({ ...current, trust: result.data.trust, screen: result.data.screen });
        setError(null);
      }
    } catch {
      setError("Lecter could not reach the core to save your answer.");
    } finally {
      setBusy(false);
    }
  }

  return { course, error, busy, open, answer };
}
