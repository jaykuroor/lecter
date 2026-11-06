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
  /**
   * The course details form's first values `course_trust` sends with a Trust answer (`null`: the
   * course's details are saved already). `course_details_save` answers with what it was sent.
   */
  details: Commands["course_trust"]["result"]["details"];
  /**
   * The courses on the rail at start (`course_list`), in order. `course_open` adds the course it
   * opens (first letter as icon, default colour) and sends `course:changed`; `course_reorder`
   * takes any order of the same paths, each once.
   */
  rail: Commands["course_list"]["result"];
  /**
   * What `course_switch` opens, by course path. A path not on the rail is E_INVALID_ARGUMENT; one on
   * the rail but not here (a missing folder) is E_NOT_FOUND.
   */
  switch: Record<string, Commands["course_switch"]["result"]>;
  /** The layout saved by an earlier run (`app_layout_get`); `app_layout_save` replaces it. */
  layout: Commands["app_layout_get"]["result"];
  /** keymaps.jsonc's text (`keymaps_read`; null: no file), or the core's error for an unusable one. */
  keymaps: Commands["keymaps_read"]["result"] | { error: string };
  /**
   * The settings: the schema text `settings_schema` serves, and each key's value in force (JSON
   * text) with its level. `settings_get` answers from `values` (another key is E_NOT_FOUND);
   * `settings_set` keeps the value as global and records the call (window.__mockSettings). The
   * mock trusts the UI's own check of the value against the schema.
   */
  settings: { schema: string; values: Record<string, Omit<Commands["settings_get"]["result"], "key">> };
  /** What `theme_get` answers (the tokens in force) and `theme_list` lists (installed GTK themes). */
  theme: { update: Commands["theme_get"]["result"]; installed: Commands["theme_list"]["result"] };
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
  blocked: null,
};

export const defaultFixture: MockFixture = {
  appInfo: { name: "Lecter", version: "0.0.1" },
  courseOpen: null,
  lectures: {},
  find: {},
  gloss: { deltas: ["**Sample answer.** ", "This is ", "the mocked core."], deltaMs: 30 },
  details: null,
  rail: [],
  switch: {},
  layout: { sidebar: true },
  keymaps: null,
  settings: { schema: '{"type":"object","properties":{}}', values: {} },
  theme: { update: { theme: null, scheme: null, tokens: [] }, installed: [] },
};
