// The Settings window's pages (12-settings-theme-onboarding.md#settings): Appearance, Keys, AI
// (the harness), Providers, Courses, Notes and files, Performance, Privacy, Advanced. Every key of
// the schema lands on exactly one page by its group, so a setting a later card adds shows up
// without a change here (Advanced takes what no rule names). Labels come from the keys themselves.

export type PageId =
  | "appearance"
  | "keys"
  | "ai"
  | "providers"
  | "courses"
  | "notes"
  | "performance"
  | "privacy"
  | "advanced";

export interface Page {
  id: PageId;
  title: string;
}

/** The pages in the order the window lists them. */
export const PAGES: readonly Page[] = [
  { id: "appearance", title: "Appearance" },
  { id: "keys", title: "Keys" },
  { id: "ai", title: "AI" },
  { id: "providers", title: "Providers" },
  { id: "courses", title: "Courses" },
  { id: "notes", title: "Notes and files" },
  { id: "performance", title: "Performance" },
  { id: "privacy", title: "Privacy" },
  { id: "advanced", title: "Advanced" },
];

/**
 * Which page shows a key, first match wins: an exact key, or a group (`ui.`). The models and
 * hedging pick a provider (Providers); the rest of `ai.*` is the harness (AI); the course search
 * index and lecture names are per course (Courses); slides and figures are Notes and files.
 */
const RULES: readonly (readonly [string, PageId])[] = [
  ["ui.performance", "performance"],
  ["ui.", "appearance"],
  ["ai.defaultFast", "providers"],
  ["ai.defaultStrong", "providers"],
  ["ai.backupProvider", "providers"],
  ["ai.hedgeAfterMs", "providers"],
  ["ai.", "ai"],
  ["index.", "courses"],
  ["lectures.", "courses"],
  ["parsing.", "notes"],
  ["figures.", "notes"],
  ["privacy.", "privacy"],
  ["feedback.", "privacy"],
  ["log.", "privacy"],
];

/** The page that shows `key`. */
export function pageOf(key: string): PageId {
  for (const [rule, page] of RULES) {
    if (rule.endsWith(".") ? key.startsWith(rule) : key === rule) return page;
  }
  return "advanced";
}

/** The title of page `id`. */
export const pageTitle = (id: PageId): string => PAGES.find((p) => p.id === id)?.title ?? "";

/** A camelCase or kebab-case word run as lowercase words: `allowDomains` → `allow domains`. */
function words(part: string): string {
  return part
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/-/g, " ")
    .toLowerCase();
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A key's label: its parts after the group, in words, the first capitalised: `ui.hintBar` →
 * `Hint bar`, `ai.search.allowDomains` → `Search › allow domains`. A key with one part is itself.
 */
export function labelOf(key: string): string {
  const parts = key.split(".");
  const shown = parts.length > 1 ? parts.slice(1) : parts;
  return capital(shown.map(words).join(" › "));
}

/** A value of a fixed set as a word: `local-small` → `Local small`. */
export const choiceLabel = (value: string): string => capital(words(value));
