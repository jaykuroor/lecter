const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A lecture's front-matter date (`YYYY-MM-DD`, 03-lecture-files.md#front-matter) as the sidebar
 * shows it, e.g. "Oct 23"; `null` for anything that isn't a real calendar day. The UI is English
 * in v0, so the month names are fixed rather than taken from the system's locale.
 */
export function shortDate(iso: string): string | null {
  const m = ISO_DAY.exec(iso);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Date.UTC rolls an impossible day over (Feb 30 → Mar 2): a real day comes back unchanged.
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${MONTHS[month - 1]} ${day}`;
}
