const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A lecture's front-matter date (`YYYY-MM-DD`, 03-lecture-files.md#front-matter) as the sidebar
 * shows it, e.g. "Oct 23"; `null` for none, or anything that isn't a real calendar day. The UI is
 * English in v0, so the month names are fixed rather than taken from the system's locale.
 */
export function shortDate(iso: string | null | undefined): string | null {
  // String(null) and String(undefined) don't match either.
  const m = ISO_DAY.exec(String(iso));
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) return null;
  return `${MONTHS[month - 1]} ${day}`;
}

/** The days in `month` (1–12) of `year`: day 0 of the next month is this month's last. */
function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
