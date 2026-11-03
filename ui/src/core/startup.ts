import { commands, type StartupPaint } from "./bindings";

export type { StartupPaint };

/**
 * Tells the core the UI has just painted `paint`, so it logs its `startup <phase> <ms>` line
 * (14-quality.md#performance-budgets). Not awaited: a lost mark costs a log line, nothing else.
 */
export function markStartup(paint: StartupPaint): void {
  commands.appMarkStartup(paint).catch(() => undefined);
}
