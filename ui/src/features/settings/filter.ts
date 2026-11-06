// The Settings window's search (12-settings-theme-onboarding.md#settings: searchable). Each
// setting's searchable text (key, label, description, page and values) is lowercased once when the
// schema comes in; a query is its words, each of which must appear. A query that only grew from
// the last one (another letter, another word) narrows the last matches instead of looking at every
// setting again (D-237).
import type { SettingSpec } from "../cmdline/schema";
import { choiceLabel, labelOf, type PageId, pageOf, pageTitle } from "./pages";

/** One setting as the window shows and searches it. */
export interface Entry {
  spec: SettingSpec;
  page: PageId;
  label: string;
  /** Everything a query is matched against, lowercased. */
  text: string;
}

/** The entries of `specs`, in schema (key) order. */
export function entriesOf(specs: readonly SettingSpec[]): Entry[] {
  return specs.map((spec) => {
    const page = pageOf(spec.key);
    const label = labelOf(spec.key);
    const choices = spec.choices.map((c) => `${c} ${choiceLabel(c)}`).join(" ");
    const text = `${spec.key} ${label} ${spec.description} ${pageTitle(page)} ${choices}`.toLowerCase();
    return { spec, page, label, text };
  });
}

/** A query's words, lowercased; none for a blank query. */
const wordsOf = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * A search over `entries`: call it with each query as it is typed; it answers the entries that
 * have every word of the query, in entry order (every entry for a blank query).
 */
export function createFilter(entries: readonly Entry[]): (query: string) => readonly Entry[] {
  let lastQuery = "";
  let last: readonly Entry[] = entries;
  return (query) => {
    const words = wordsOf(query);
    if (words.length === 0) return entries;
    // Every match of a query is a match of any query it grew from, whatever came in between.
    const from = query.startsWith(lastQuery) ? last : entries;
    const found = from.filter((e) => words.every((w) => e.text.includes(w)));
    lastQuery = query;
    last = found;
    return found;
  };
}
