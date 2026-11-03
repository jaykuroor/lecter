// Sampling for the idle attribution (F-180): a snapshot of the app's processes and threads every
// `stepMs` for `windowMs`, with no WebDriver command in between, so the page and the embedded
// WebDriver server stay idle. The pauses are the measurement itself, not synchronisation.

import { type Snapshot, snapshot } from "./threads.ts";

/** Samples `exe`'s group from now for `windowMs`, every `stepMs`; returns windowMs/stepMs + 1 snapshots. */
export async function sample(exe: string, windowMs: number, stepMs: number): Promise<Snapshot[]> {
  const start = Date.now();
  const out = [snapshot(exe)];
  for (let i = 1; i * stepMs <= windowMs; i++) {
    const wait = start + i * stepMs - Date.now();
    if (wait > 0) await browser.pause(wait);
    out.push(snapshot(exe));
  }
  return out;
}
