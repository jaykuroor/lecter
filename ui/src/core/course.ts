import {
  type CourseDetails,
  type CourseFile,
  type CourseOpened,
  type CourseTrusted,
  commands,
  events,
  type IpcError,
  type KnownCourse,
  type TrustChoice,
  type TrustScreen,
} from "./bindings";

export type { CourseDetails, CourseFile, CourseOpened, KnownCourse, TrustChoice, TrustScreen };

/** What reading or reordering the course rail came to: its courses in order, or the core's error. */
export type CourseRailResult = { status: "ok"; data: KnownCourse[] } | { status: "error"; error: IpcError };

/** What switching to a course on the rail came to: the course as `openCourse` gives it, or the core's error. */
export type CourseSwitchResult = { status: "ok"; data: CourseOpened } | { status: "error"; error: IpcError };

/**
 * The courses on the rail, in order, with their name, icon and colour (`course_list`, D-188). A
 * course whose folder is gone or leads elsewhere is `missing`.
 */
export function listCourses(): Promise<CourseRailResult> {
  return commands.courseList();
}

/**
 * Saves a new rail order: every course's path, each once (`course_reorder`). Answers with the rail
 * as the core now has it.
 */
export function reorderCourses(order: string[]): Promise<CourseRailResult> {
  return commands.courseReorder(order);
}

/**
 * Opens `course`, a course on the rail, without the folder dialog (`course_switch`). The core
 * checks it is on the rail and still the folder that was picked, then reviews its trust as for a
 * pick (SEC-32, SEC-35).
 */
export function switchCourse(course: string): Promise<CourseSwitchResult> {
  return commands.courseSwitch(course);
}

/**
 * Calls `listener` with the rail's courses each time they change (`course:changed`: a course was
 * added or the order saved). Resolves to the function that stops listening.
 */
export async function onCoursesChanged(listener: (courses: KnownCourse[]) => void): Promise<() => void> {
  const unlisten = await events.courseChanged.listen((event) => listener(event.payload.courses));
  // Tauri's unlisten is async underneath; a core already gone has nothing left to stop.
  return () => {
    Promise.resolve(unlisten()).catch(() => {});
  };
}

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
