import { commands, type IpcError, type Lecture } from "./bindings";

export type { Lecture };

/** What opening a lecture came to: the lecture, or the core's error. */
export type LectureOpenResult = { status: "ok"; data: Lecture } | { status: "error"; error: IpcError };

/**
 * Reads the lecture at `path` (`lectures/<name>.md`) of `course`, a course `course_open` returned
 * this session (`lecture_open`). The core checks both (SEC-32, SEC-35).
 */
export function openLecture(course: string, path: string): Promise<LectureOpenResult> {
  return commands.lectureOpen(course, path);
}
