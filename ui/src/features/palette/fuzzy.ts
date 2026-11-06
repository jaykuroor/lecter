// Fuzzy matching for the palette and the quick switcher (09-ui.md#slack-and-discord-behaviours):
// the query's letters must appear in the text in order, in any case; among the ways they do, the
// best one wins. Letters next to each other and letters at the start of a word count most, gaps
// cost a little, so `cov` finds "covariance" before "c-o-v", and `l07` finds "…-l07-covariance.md".
// One pass per query letter over the text (no backtracking), so a long list filters per keystroke.

/** A match: how good it is (higher is better), and the text's indices the query's letters took. */
export interface FuzzyMatch {
  score: number;
  hits: number[];
}

/** Points for each matched letter. */
const MATCH = 16;
/** Bonus for a letter that starts a word (after a space, `-`, `_`, `/`, `.` or at the start). */
const BOUNDARY = 8;
/** Bonus for a capital after a small letter (`openSlides`). */
const CAMEL = 7;
/** The least bonus a letter gets for following the previous one; a run keeps its first letter's bonus. */
const CONSECUTIVE = 4;
/** What a gap between two matched letters costs to open, and per letter after the first. */
const GAP_OPEN = 3;
const GAP_EXTEND = 1;
/** Texts and queries are cut to this many characters: a name never needs more. */
const LIMIT = 256;

/** The bonus for matching `text[i]`: a word start, a camel hump, or none. */
function bonusAt(text: string, i: number): number {
  if (i === 0) return BOUNDARY;
  const prev = text[i - 1] as string;
  const cur = text[i] as string;
  if (!/[\p{L}\p{N}]/u.test(prev)) return BOUNDARY;
  if (prev !== prev.toUpperCase() && cur !== cur.toLowerCase()) return CAMEL;
  return 0;
}

/**
 * Matches `query` (spaces in it are ignored) against `text`. `null` when the text lacks one of its
 * letters in order; an empty query matches with no hits and score 0.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = [...query.replace(/\s+/g, "").toLowerCase()].slice(0, LIMIT);
  if (q.length === 0) return { score: 0, hits: [] };
  const raw = text.slice(0, LIMIT);
  const t = raw.toLowerCase();
  const n = t.length;
  if (q.length > n) return null;
  const bonus = Array.from({ length: n }, (_, i) => bonusAt(raw, i));
  const NONE = Number.NEGATIVE_INFINITY;
  // score[j][i]: the best score with query letter j on text index i; run[j][i]: that run's bonus;
  // from[j][i]: where letter j-1 went on that path.
  const score: number[][] = [];
  const run: number[][] = [];
  const from: number[][] = [];
  for (let j = 0; j < q.length; j++) {
    const row = new Array<number>(n).fill(NONE);
    const runRow = new Array<number>(n).fill(0);
    const fromRow = new Array<number>(n).fill(-1);
    const prev = score[j - 1];
    // The best of (prev[k] + k) over k ≤ i - 2, and its k: a gap of i - k - 1 letters costs
    // GAP_OPEN + (i - k - 2) * GAP_EXTEND, which is (i - k + 1) at these constants.
    let bestGap = NONE;
    let bestGapAt = -1;
    for (let i = 0; i < n; i++) {
      if (prev && i >= 2) {
        const k = i - 2;
        const v = (prev[k] as number) + k * GAP_EXTEND;
        if (v > bestGap) {
          bestGap = v;
          bestGapAt = k;
        }
      }
      if (t[i] !== q[j]) continue;
      const own = bonus[i] as number;
      if (!prev) {
        row[i] = MATCH + own;
        runRow[i] = own;
        continue;
      }
      // Right after the previous letter: the run's bonus carries on.
      const before = i >= 1 ? (prev[i - 1] as number) : NONE;
      if (before > NONE) {
        const carried = Math.max(CONSECUTIVE, own, run[j - 1]?.[i - 1] as number);
        row[i] = before + MATCH + carried;
        runRow[i] = carried;
        fromRow[i] = i - 1;
      }
      if (bestGap > NONE) {
        const gapped = bestGap - i * GAP_EXTEND - (GAP_OPEN - 2 * GAP_EXTEND) + MATCH + own;
        if (gapped > (row[i] as number)) {
          row[i] = gapped;
          runRow[i] = own;
          fromRow[i] = bestGapAt;
        }
      }
    }
    score.push(row);
    run.push(runRow);
    from.push(fromRow);
  }
  const last = score[q.length - 1] as number[];
  let end = -1;
  for (let i = 0; i < n; i++)
    if ((last[i] as number) > NONE && (end === -1 || (last[i] as number) > (last[end] as number))) end = i;
  if (end === -1) return null;
  const hits: number[] = [];
  for (let j = q.length - 1, i = end; j >= 0; j--) {
    hits.unshift(i);
    i = from[j]?.[i] as number;
  }
  return { score: last[end] as number, hits };
}

/** One item that matched, with its match. */
export interface Filtered<T> extends FuzzyMatch {
  item: T;
}

/** The items whose `text` matches `query`, best first; equal scores keep the list's order. */
export function fuzzyFilter<T>(items: readonly T[], query: string, text: (item: T) => string): Filtered<T>[] {
  const out: (Filtered<T> & { at: number })[] = [];
  items.forEach((item, at) => {
    const m = fuzzyMatch(query, text(item));
    if (m) out.push({ item, at, ...m });
  });
  out.sort((a, b) => b.score - a.score || a.at - b.at);
  return out.map(({ item, score, hits }) => ({ item, score, hits }));
}
