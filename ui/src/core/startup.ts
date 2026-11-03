import { commands, type StartupPaint } from "./bindings";

/**
 * Tells the core the UI has just painted `paint`, so it logs its `startup <phase> <ms>` line
 * (14-quality.md#performance-budgets). Also leaves a `startup:<paint>` performance mark in the
 * page, which the cold-open flow reads (tests/e2e/flows/cold-open.ts). Not awaited: a lost mark
 * costs a log line, nothing else.
 */
export function markStartup(paint: StartupPaint): void {
  performance.mark(`startup:${paint}`);
  commands.appMarkStartup(paint).catch(() => undefined);
}
