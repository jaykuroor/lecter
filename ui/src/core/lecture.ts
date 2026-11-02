import { commands, type Edit, type IpcError, type Lecture } from "./bindings";

export type { Edit, Lecture };

/** What opening a lecture came to: the lecture, or the core's error. */
export type LectureOpenResult = { status: "ok"; data: Lecture } | { status: "error"; error: IpcError };

/** What sending edits came to: done, or the core's error. */
export type EditsResult = { status: "ok"; data: null } | { status: "error"; error: IpcError };

/**
 * Reads the lecture at `path` (`lectures/<name>.md`) of `course`, a course `course_open` returned
 * this session (`lecture_open`). The core checks both (SEC-32, SEC-35).
 */
export function openLecture(course: string, path: string): Promise<LectureOpenResult> {
  return commands.lectureOpen(course, path);
}

/**
 * Sends `edits` (UTF-16 positions, each counted after the one before) to the open lecture `path`
 * of `course` (`lecture_apply_edits`); it answers once they are in the lecture's journal.
 */
export function applyEdits(course: string, path: string, edits: Edit[]): Promise<EditsResult> {
  return commands.lectureApplyEdits(course, path, edits);
}
