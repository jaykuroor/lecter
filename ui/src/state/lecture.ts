import { type Accessor, createSignal } from "solid-js";
import { type Lecture, openLecture } from "../core/lecture";

/** The lecture in the buffer and the state of opening one. */
export interface LectureState {
  /** The lecture on screen, or `null` before one is opened. */
  lecture: Accessor<Lecture | null>;
  /** The last open's error message, cleared by the next successful open. */
  error: Accessor<string | null>;
  /** Asks the core for a lecture of an opened course. A failed open keeps the current lecture. */
  open: (course: string, path: string) => Promise<void>;
}

export function createLecture(): LectureState {
  const [lecture, setLecture] = createSignal<Lecture | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  // Only the newest request may fill the buffer: an older answer arriving late is dropped.
  let latest = 0;

  async function open(course: string, path: string): Promise<void> {
    const request = ++latest;
    try {
      const result = await openLecture(course, path);
      if (request !== latest) return;
      if (result.status === "error") {
        setError(result.error.message);
      } else {
        setLecture(result.data);
        setError(null);
      }
    } catch {
      if (request === latest) setError("Lecter could not reach the core to open the lecture.");
    }
  }

  return { lecture, error, open };
}
