import { type Accessor, createSignal } from "solid-js";
import { applyEdits, type Edit, type Lecture, openLecture } from "../core/lecture";

/** The lecture in the buffer and the state of opening one. */
export interface LectureState {
  /** The lecture on screen, or `null` before one is opened. */
  lecture: Accessor<Lecture | null>;
  /** The last open's or save's error message, cleared by the next successful open. */
  error: Accessor<string | null>;
  /** Asks the core for a lecture of an opened course. A failed open keeps the current lecture. */
  open: (course: string, path: string) => Promise<void>;
  /**
   * Sends edits to the lecture on screen without waiting (F-021): never awaited on the key path.
   * Batches go one at a time, in order, so the core applies them as the buffer made them.
   */
  edit: (edits: Edit[]) => void;
  /** Resolves once every edit so far has been answered (tests and quitting wait on it). */
  settled: () => Promise<void>;
}

/** Edits for one lecture, in order. */
interface Pending {
  course: string;
  path: string;
  edits: Edit[];
}

/** One edit waiting to be sent, with the lecture it was made in. */
interface Queued {
  course: string;
  path: string;
  edit: Edit;
}

/**
 * The most edits and UTF-16 units of text one `lecture_apply_edits` carries: with JSON escaping
 * (at most 6 bytes a unit) that stays under the core's 1 MB payload and 10,000-item list limits
 * (18-contracts.md#validation). A single edit larger than that goes alone.
 */
const MAX_BATCH_EDITS = 1_000;
const MAX_BATCH_UNITS = 131_072;

/** Takes the next batch off a non-empty `queue`: at least one edit, all for one lecture, within the limits. */
function nextBatch(queue: Queued[]): Pending {
  const first = queue[0] as Queued;
  let count = 0;
  let units = 0;
  for (const q of queue) {
    if (q.course !== first.course || q.path !== first.path) break;
    if (count === MAX_BATCH_EDITS || (count > 0 && units + q.edit.text.length > MAX_BATCH_UNITS)) break;
    count += 1;
    units += q.edit.text.length;
  }
  return { course: first.course, path: first.path, edits: queue.splice(0, count).map((q) => q.edit) };
}

export function createLecture(): LectureState {
  const [lecture, setLecture] = createSignal<Lecture | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  // Only the newest request may fill the buffer: an older answer arriving late is dropped.
  let latest: object = {};
  // Where the buffer's edits go: the lecture on screen, set together with it.
  let target: { course: string; path: string } | null = null;
  const queue: Queued[] = [];
  // Whether a send loop runs, and the loop itself (for `settled`).
  let sending = false;
  let loop: Promise<void> = Promise.resolve();

  async function open(course: string, path: string): Promise<void> {
    const request = {};
    latest = request;
    try {
      const result = await openLecture(course, path);
      if (request !== latest) return;
      if (result.status === "error") {
        setError(result.error.message);
      } else {
        target = { course, path };
        setLecture(result.data);
        setError(null);
      }
    } catch {
      if (request === latest) setError("Lecter could not reach the core to open the lecture.");
    }
  }

  /** Sends batches until the queue is empty. The last check and `sending = false` run together, so an edit queued meanwhile is never left behind. */
  async function pump(): Promise<void> {
    while (queue.length > 0) {
      const batch = nextBatch(queue);
      try {
        const result = await applyEdits(batch.course, batch.path, batch.edits);
        if (result.status === "error") setError(result.error.message);
      } catch {
        setError("Lecter could not reach the core to save your edit.");
      }
    }
    sending = false;
  }

  function edit(edits: Edit[]): void {
    const to = target;
    if (!to) return;
    for (const e of edits) queue.push({ course: to.course, path: to.path, edit: e });
    if (sending) return;
    sending = true;
    loop = pump();
  }

  async function settled(): Promise<void> {
    while (sending) await loop;
  }

  return { lecture, error, open, edit, settled };
}
