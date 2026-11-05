import { type Accessor, createSignal } from "solid-js";
import {
  answerTrust,
  type CourseDetails,
  type CourseOpened,
  openCourse,
  saveCourseDetails,
  type TrustChoice,
} from "../core/course";

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
  /**
   * The course details form's values while it is shown: after the user trusts a course whose
   * details were never saved (02-course-folder.md#course-details-coursejsonc). `null` otherwise,
   * and always for a read-only course.
   */
  details: Accessor<CourseDetails | null>;
  /** Why the last save of the details failed; cleared when the form closes. */
  detailsError: Accessor<string | null>;
  /** Saves the form into `.lecter/course.jsonc`; the form closes once the core has written it. */
  saveDetails: (details: CourseDetails) => Promise<void>;
  /** Closes the form without writing anything. */
  skipDetails: () => void;
}

export function createCourse(): CourseState {
  const [course, setCourse] = createSignal<CourseOpened | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [details, setDetails] = createSignal<CourseDetails | null>(null);
  const [detailsError, setDetailsError] = createSignal<string | null>(null);

  function closeDetails(): void {
    setDetails(null);
    setDetailsError(null);
  }

  async function open(): Promise<void> {
    if (busy()) return;
    setBusy(true);
    try {
      const result = await openCourse();
      if (result.status === "error") {
        setError(result.error.message);
      } else if (result.data) {
        // Another course's form doesn't stay over this one.
        closeDetails();
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
      } else {
        // `open` waits while busy, so the course is still `current`.
        setCourse({ ...current, trust: result.data.trust, screen: result.data.screen });
        // The core sends the form only for a course it now trusts.
        setDetails(result.data.trust === "trusted" ? (result.data.details ?? null) : null);
        setError(null);
      }
    } catch {
      setError("Lecter could not reach the core to save your answer.");
    } finally {
      setBusy(false);
    }
  }

  async function saveDetails(values: CourseDetails): Promise<void> {
    const current = course();
    if (busy() || !current || !details()) return;
    setBusy(true);
    try {
      const result = await saveCourseDetails(current.path, values);
      if (result.status === "error") {
        setDetailsError(result.error.message);
      } else {
        closeDetails();
      }
    } catch {
      setDetailsError("Lecter could not reach the core to save the course details.");
    } finally {
      setBusy(false);
    }
  }

  return { course, error, busy, open, answer, details, detailsError, saveDetails, skipDetails: closeDetails };
}
