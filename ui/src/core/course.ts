import { type CourseFile, type CourseOpened, commands, type IpcError } from "./bindings";

export type { CourseFile, CourseOpened };

/** What opening a course came to: the course, a cancelled dialog (`null`), or the core's error. */
export type CourseOpenResult = { status: "ok"; data: CourseOpened | null } | { status: "error"; error: IpcError };

/**
 * Opens the native folder dialog and lists the chosen course (`course_open`). The path never
 * comes from the UI: the core asks the user (SEC-32, SEC-35).
 */
export function openCourse(): Promise<CourseOpenResult> {
  return commands.courseOpen();
}
