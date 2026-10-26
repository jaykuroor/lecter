import { type Accessor, createSignal } from "solid-js";
import { type FindHit, findInCourse } from "../core/search";

/** The last `:find` and its hits. */
export interface FindState {
  /** The words last searched for, trimmed; empty before the first search. */
  query: Accessor<string>;
  /** Their hits, best first; empty before the first search and when nothing matches. */
  hits: Accessor<FindHit[]>;
  /** The last search's error message, cleared by the next successful search. */
  error: Accessor<string | null>;
  /** Whether a search is waiting for the core. */
  busy: Accessor<boolean>;
  /**
   * Searches the lectures opened in `course` for `query`'s words (`search_find`). No course (`null`)
   * or no words gives a message instead of a call. Only the newest search fills the list.
   */
  run: (course: string | null, query: string) => Promise<void>;
}

export function createFind(): FindState {
  const [query, setQuery] = createSignal("");
  const [hits, setHits] = createSignal<FindHit[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  // An older answer arriving after a newer search is dropped.
  let latest: object = {};

  async function run(course: string | null, raw: string): Promise<void> {
    const words = raw.trim();
    const request = {};
    latest = request;
    setQuery(words);
    setHits([]);
    if (!course) {
      setError("Open a course to search its lectures.");
      return;
    }
    if (!words) {
      setError("Type the words to find, as in :find covariance.");
      return;
    }
    setBusy(true);
    try {
      const result = await findInCourse(course, words);
      if (request !== latest) return;
      if (result.status === "error") {
        setError(result.error.message);
      } else {
        setHits(result.data);
        setError(null);
      }
    } catch {
      if (request === latest) setError("Lecter could not reach the core to search.");
    } finally {
      if (request === latest) setBusy(false);
    }
  }

  return { query, hits, error, busy, run };
}
