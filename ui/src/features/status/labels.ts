// What the status line's segments say (09-ui.md#layout: mode, course/lecture, slide, active model,
// lecture cost, job spinner). Pure, so the first-paint chunk carries only these few lines.

/** Vim's mode as the buffer reports it (`vim-mode-change`). */
export type VimMode = "normal" | "insert" | "visual" | "replace";

/** The four modes the status line shows, each with its colours (tokens.json mode-colors). */
export type StatusMode = "normal" | "insert" | "visual" | "command";

export const MODE_LABEL: Readonly<Record<StatusMode, string>> = {
  normal: "NORMAL",
  insert: "INSERT",
  visual: "VISUAL",
  command: "COMMAND",
};

/**
 * The mode to show: COMMAND while a command line is open (Lecter's `:` box or Vim's own prompt),
 * else Vim's mode; replace mode counts as insert (Lecter drops `R`, 10-keymap.md#vim-subset-kept).
 */
export function statusMode(vim: VimMode, command: boolean): StatusMode {
  if (command) return "command";
  return vim === "replace" ? "insert" : vim;
}

/** A lecture file name's leading `YYYY-MM-DD` date, and what follows its dash. */
const DATED = /^\d{4}-\d{2}-\d{2}(?:-(.*))?$/;

/**
 * A lecture file's short name: without `.md` and a leading date, its first dash-separated word
 * (`2026-10-23-l07-covariance.md` → `l07`, `01-taking-notes.md` → `01`); a name that is only a
 * date stays whole.
 */
export function lectureId(file: string): string {
  const stem = file.replace(/\.md$/, "");
  const dated = DATED.exec(stem);
  const rest = dated ? (dated[1] ?? "") : stem;
  return rest.split("-")[0] || stem;
}

/** The course/lecture segment (`STAT311/l07`); the course alone before a lecture is open. */
export function placeLabel(course: string | null, lecture: string | null): string | null {
  if (course === null) return null;
  return lecture === null ? course : `${course}/${lectureId(lecture)}`;
}

/** The lecture's cost in dollars, to the cent; nothing when it isn't known. */
export function costLabel(dollars: number | null): string | null {
  if (dollars === null || !Number.isFinite(dollars) || dollars < 0) return null;
  if (dollars > 0 && dollars < 0.005) return "<$0.01";
  return `$${dollars.toFixed(2)}`;
}

/** The slide the cursor is in, as its heading numbers it (`SLIDE n / N`). */
export interface SlidePos {
  n: number;
  total: number;
}

/** The slide segment: `n/N` on screen, in words for assistive tools. */
export function slideLabel(slide: SlidePos): { text: string; words: string } {
  return { text: `${slide.n}/${slide.total}`, words: `Slide ${slide.n} of ${slide.total}` };
}
