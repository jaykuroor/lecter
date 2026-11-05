/**
 * The sidebar is a chunk of its own: it has nothing to show before a course opens, which can't
 * happen before the shell's first paint, so its code stays out of the first-paint chunk
 * (cold_open_ms, 14-quality.md#performance-budgets). The app starts loading it right after the
 * first paint; the rail column renders it from the same load. One load per page, shared.
 */
let chunk: Promise<typeof import("./Sidebar")> | undefined;

export function loadSidebar(): Promise<typeof import("./Sidebar")> {
  chunk ??= import("./Sidebar");
  return chunk;
}
