import { commands, type FindHit, type IpcError } from "./bindings";

export type { FindHit };

/** What a search came to: the hits, best first, or the core's error. */
export type FindResult = { status: "ok"; data: FindHit[] } | { status: "error"; error: IpcError };

/**
 * Searches the blocks of the lectures opened in `course` (a course `course_open` returned this
 * session) for the words of `query` (`search_find`). The core caps the query at 1 KB (SEC-32).
 */
export function findInCourse(course: string, query: string): Promise<FindResult> {
  return commands.searchFind(course, query);
}
