// Which memory sample rss_300_slides_mb counts (14-quality.md#performance-budgets). After the
// scroll, the measurement takes one sample, then one after each 5 s settle. On macOS WebContent's
// phys_footprint right after the scroll holds a transient (D-161), and when WebKit releases its
// paint memory varies from run to run (230-438 MB on the same code, D-225): there the median of
// several settles counts. Elsewhere one settle, and the larger of the two samples counts.
// Plain functions, so ui/test/rss-settle.test.ts checks them without the app.

// No `.ts`: ui's tsc checks this file through ui/test/rss-settle.test.ts (tests/CLAUDE.md).
import { median } from "../../e2e/flows/cold-open/budget";

/** The wait before each sample after the first. */
export const SETTLE_MS = 5_000;

/** The settles each OS samples: the median of 3 on macOS (D-225), one elsewhere. */
export function settles(os: string): number {
  return os === "darwin" ? 3 : 1;
}

export interface Counted {
  /** The budget's value, MB. */
  value: number;
  /** Which sample it is: 0 at the scroll, n after the nth settle. */
  from: number;
  /** Every sample and the rule that picked the value, for the report. */
  detail: string;
}

/** The value that counts on `os` from the sample at the scroll and those after each settle. */
export function counted(os: string, atScroll: number, afterSettles: number[]): Counted {
  const n = settles(os);
  if (afterSettles.length !== n) {
    throw new Error(`${os} samples after ${n} settle${n === 1 ? "" : "s"}, got ${afterSettles.length}`);
  }
  const all = [atScroll, ...afterSettles];
  const value = n > 1 ? median(afterSettles) : Math.max(atScroll, afterSettles[0] as number);
  const from = all.lastIndexOf(value);
  const mb = (xs: number[]) => xs.map((x) => x.toFixed(1)).join(", ");
  const rule = n > 1 ? `${os}: the median of ${n} settles counts` : "the larger of the two counts";
  return {
    value,
    from,
    detail: `${mb([atScroll])} MB at the scroll, then ${mb(afterSettles)} MB after each ${SETTLE_MS / 1000} s settle (${rule})`,
  };
}
