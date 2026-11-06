// Fuzzy matching for the palette and the quick switcher (09-ui.md#slack-and-discord-behaviours):
// the query's letters must appear in the text in order, in any case; among the ways they do, the
// best one wins. Letters next to each other and letters at the start of a word count most, gaps
// cost a little, so `cov` finds "covariance" before "c-o-v", and `l07` finds "…-l07-covariance.md".
// One pass per query letter over the text (no backtracking), so a long list filters per keystroke.
//
// The score: each matched letter is worth MATCH plus a bonus: BOUNDARY at a word start, CAMEL at
// a capital after a small letter, else 0; a letter right after the previous one gets the run's
// bonus instead (the run's first letter's, at least CONSECUTIVE). A gap of g letters between two
// matched letters costs GAP_OPEN + (g - 1). On a tie, letters together win over a gap, and the
// earliest end wins.

/** A match: how good it is (higher is better), and the text's indices the query's letters took. */
export interface FuzzyMatch {
  score: number;
  hits: number[];
}

const MATCH = 16;
const BOUNDARY = 8;
const CAMEL = 7;
const CONSECUTIVE = 4;
const GAP_OPEN = 3;
/** Texts and queries are cut to this many UTF-16 units: a name never needs more. */
const LIMIT = 256;

/** The bonus for matching `text[i]`: a word start, a camel hump, or none. */
function bonusAt(text: string, i: number): number {
  const prev = text[i - 1];
  if (prev === undefined || !/[\p{L}\p{N}]/u.test(prev)) return BOUNDARY;
  const cur = text[i] as string;
  if (prev !== prev.toUpperCase() && cur !== cur.toLowerCase()) return CAMEL;
  return 0;
}

/** The best way to have matched a query letter on a text index. */
interface Cell {
  score: number;
  /** The bonus the run this letter ends carries on. */
  run: number;
  /** Where the previous query letter went (none for the first). */
  from?: number;
}

/**
 * Matches `query` (spaces in it are ignored) against `text`. `null` when the text lacks one of its
 * letters in order; an empty query matches with no hits and score 0.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.replace(/\s/g, "").toLowerCase().slice(0, LIMIT);
  if (q === "") return { score: 0, hits: [] };
  const raw = text.slice(0, LIMIT);
  const t = raw.toLowerCase();
  const rows: Map<number, Cell>[] = [];
  let prev: Map<number, Cell> | null = null;
  for (let j = 0; j < q.length; j++) {
    const row = new Map<number, Cell>();
    // The best of (score + index) over the previous letter's cells at least 2 before `i`: a gap
    // from k to i costs GAP_OPEN + (i - k - 2), so it scores best + 2 - GAP_OPEN - i.
    let best: { value: number; at: number } | null = null;
    for (let i = 0; i < t.length; i++) {
      const behind = prev?.get(i - 2);
      if (behind && (!best || behind.score + i - 2 > best.value)) best = { value: behind.score + i - 2, at: i - 2 };
      if (t[i] !== q[j]) continue;
      const own = bonusAt(raw, i);
      if (!prev) {
        row.set(i, { score: MATCH + own, run: own });
        continue;
      }
      const before = prev.get(i - 1);
      let cell: Cell | null = null;
      if (before) {
        const run = Math.max(CONSECUTIVE, own, before.run);
        cell = { score: before.score + MATCH + run, run, from: i - 1 };
      }
      if (best) {
        const gapped = best.value + 2 - GAP_OPEN - i + MATCH + own;
        if (!cell || gapped > cell.score) cell = { score: gapped, run: own, from: best.at };
      }
      if (cell) row.set(i, cell);
    }
    rows.push(row);
    prev = row;
  }
  let end: [number, Cell] | null = null;
  for (const entry of rows[rows.length - 1] as Map<number, Cell>)
    if (!end || entry[1].score > end[1].score) end = entry;
  if (!end) return null;
  const hits: number[] = [];
  for (let j = rows.length - 1, i = end[0]; j >= 0; j--) {
    hits.unshift(i);
    i = ((rows[j] as Map<number, Cell>).get(i) as Cell).from as number;
  }
  return { score: end[1].score, hits };
}

/** One item that matched, with its match. */
export interface Filtered<T> extends FuzzyMatch {
  item: T;
}

/** The items whose `text` matches `query`, best first; equal scores keep the list's order (a stable sort). */
export function fuzzyFilter<T>(items: readonly T[], query: string, text: (item: T) => string): Filtered<T>[] {
  const out: Filtered<T>[] = [];
  for (const item of items) {
    const m = fuzzyMatch(query, text(item));
    if (m) out.push({ item, ...m });
  }
  return out.sort((a, b) => b.score - a.score);
}
