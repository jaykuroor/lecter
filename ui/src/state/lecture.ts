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

/**
 * The most edits and UTF-16 units of text one `lecture_apply_edits` carries: with JSON escaping
 * (at most 6 bytes a unit) that stays under the core's 1 MB payload and 10,000-item list limits
 * (18-contracts.md#validation).
 */
const MAX_BATCH_EDITS = 1_000;
const MAX_BATCH_UNITS = 131_072;

/** Takes the next batch off `queue`: edits for one lecture, within the limits. */
function nextBatch(queue: Pending[]): Pending | null {
  const first = queue[0];
  if (!first) return null;
  const batch: Pending = { course: first.course, path: first.path, edits: [] };
  let units = 0;
  while (queue.length > 0) {
    const head = queue[0];
    if (!head || head.course !== batch.course || head.path !== batch.path) break;
    const edit = head.edits[0];
    if (!edit) {
      queue.shift();
      continue;
    }
    const full = batch.edits.length >= MAX_BATCH_EDITS || units + edit.text.length > MAX_BATCH_UNITS;
    if (full && batch.edits.length > 0) break;
    batch.edits.push(edit);
    units += edit.text.length;
    head.edits.shift();
  }
  return batch;
}

export function createLecture(): LectureState {
  const [lecture, setLecture] = createSignal<Lecture | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  // Only the newest request may fill the buffer: an older answer arriving late is dropped.
  let latest: object = {};
  // Where the buffer's edits go: the lecture on screen, set together with it.
  let target: { course: string; path: string } | null = null;
  const queue: Pending[] = [];
  let sending: Promise<void> | null = null;

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

  async function pump(): Promise<void> {
    for (let batch = nextBatch(queue); batch; batch = nextBatch(queue)) {
      if (batch.edits.length === 0) continue;
      try {
        const result = await applyEdits(batch.course, batch.path, batch.edits);
        if (result.status === "error") setError(result.error.message);
      } catch {
        setError("Lecter could not reach the core to save your edit.");
      }
    }
  }

  /** Starts sending unless a send is under way; one that ends with edits left starts again. */
  function kick(): void {
    if (sending) return;
    sending = pump().finally(() => {
      sending = null;
      if (queue.length > 0) kick();
    });
  }

  function edit(edits: Edit[]): void {
    if (!target || edits.length === 0) return;
    queue.push({ ...target, edits: [...edits] });
    kick();
  }

  async function settled(): Promise<void> {
    while (sending) await sending;
  }

  return { lecture, error, open, edit, settled };
}
