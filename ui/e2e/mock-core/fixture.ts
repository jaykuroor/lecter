import type { Commands } from "../../src/core/bindings";

/** The data the mocked core serves, typed by the generated contract. Tests override parts of it per flow. */
export interface MockFixture {
  appInfo: Commands["app_info"]["result"];
  /** What the folder dialog answers; `null` is a cancelled dialog. */
  courseOpen: Commands["course_open"]["result"];
  /** The lecture files `lecture_open` serves, by course-relative path; any other path is E_NOT_FOUND. */
  lectures: Record<string, Commands["lecture_open"]["result"]>;
}

export const defaultFixture: MockFixture = {
  appInfo: { name: "Lecter", version: "0.0.1" },
  courseOpen: null,
  lectures: {},
};
