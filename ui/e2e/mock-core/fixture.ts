import type { Commands } from "../../src/core/bindings";

/** The data the mocked core serves, typed by the generated contract. Tests override parts of it per flow. */
export interface MockFixture {
  appInfo: Commands["app_info"]["result"];
  /** What the folder dialog answers; `null` is a cancelled dialog. */
  courseOpen: Commands["course_open"]["result"];
  /** The lecture files `lecture_open` serves, by course-relative path; any other path is E_NOT_FOUND. */
  lectures: Record<string, Commands["lecture_open"]["result"]>;
  /** The hits `search_find` answers, by query exactly as sent; any other query finds nothing. */
  find: Record<string, Commands["search_find"]["result"]>;
  /**
   * The answer `gloss_request` streams, one delta per entry, `deltaMs` apart (0: all at once);
   * `gloss_cancel` stops it. Every gloss gets the next id `g-0001`, `g-0002`, ….
   */
  gloss: { deltas: string[]; deltaMs: number };
}

/** A trust screen for a small course with no AI files of its own (02-course-folder.md#trust). */
export const trustScreen: NonNullable<MockFixture["courseOpen"]>["screen"] = {
  lectures: 1,
  slides: 0,
  sources: 0,
  provider: "sample",
  webSearch: true,
  agents: [],
  roles: [],
  skills: [],
  overrides: [],
  changed: false,
};

export const defaultFixture: MockFixture = {
  appInfo: { name: "Lecter", version: "0.0.1" },
  courseOpen: null,
  lectures: {},
  find: {},
  gloss: { deltas: ["**Sample answer.** ", "This is ", "the mocked core."], deltaMs: 30 },
};
