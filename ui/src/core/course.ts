import {
  type CourseDetails,
  type CourseFile,
  type CourseOpened,
  type CourseTrusted,
  commands,
  type IpcError,
  type TrustChoice,
  type TrustScreen,
} from "./bindings";

export type { CourseDetails, CourseFile, CourseOpened, TrustChoice, TrustScreen };

/** What opening a course came to: the course, a cancelled dialog (`null`), or the core's error. */
export type CourseOpenResult = { status: "ok"; data: CourseOpened | null } | { status: "error"; error: IpcError };

/** What answering the trust screen came to: the trust in force and the screen now, or the core's error. */
export type CourseTrustResult = { status: "ok"; data: CourseTrusted } | { status: "error"; error: IpcError };

/** What saving the course details came to: the details as written, or the core's error. */
export type CourseDetailsResult = { status: "ok"; data: CourseDetails } | { status: "error"; error: IpcError };

/**
 * Opens the native folder dialog and lists the chosen course (`course_open`). The path never
 * comes from the UI: the core asks the user (SEC-32, SEC-35).
 */
export function openCourse(): Promise<CourseOpenResult> {
  return commands.courseOpen();
}

/**
 * Answers the trust screen of `course` (a path `course_open` returned): Trust, or Open read-only
 * (`course_trust`, 02-course-folder.md#trust). The core stores it and enforces it (SEC-27). A
 * course trusted for the first time comes with the course details form's first values.
 */
export function answerTrust(course: string, choice: TrustChoice): Promise<CourseTrustResult> {
  return commands.courseTrust(course, choice);
}

/**
 * Saves the course details form for `course` into `.lecter/course.jsonc` with `"version": 1`
 * (`course_details_save`, 02-course-folder.md#course-details-coursejsonc). The core checks every
 * field and writes only for a trusted course (SEC-27).
 */
export function saveCourseDetails(course: string, details: CourseDetails): Promise<CourseDetailsResult> {
  return commands.courseDetailsSave(course, details);
}
