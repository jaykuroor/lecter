// One perf measurement at a time across Playwright workers. `test:e2e` runs every spec in both
// the chromium and webkit projects with fullyParallel, so the keystroke check (which launches its
// own Chromium in either project) ran twice at once next to the other specs; on a 4-vCPU CI
// runner that roughly doubled p99 (CI-a0174c9). The lock is a file created with `wx` (atomic: one
// creator wins) in the run's output folder, which Playwright empties at the start of every run, so
// a lock left by a killed run can't block the next one.

import { mkdir, open, rm } from "node:fs/promises";
import { dirname } from "node:path";

const RETRY_MS = 100;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs `fn` while holding the lock file `lock`, waiting at most `timeoutMs` to get it. */
export async function exclusive<T>(lock: string, timeoutMs: number, fn: () => Promise<T>): Promise<T> {
  await mkdir(dirname(lock), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await (await open(lock, "wx")).close();
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (Date.now() > deadline) throw new Error(`perf lock ${lock} still held after ${timeoutMs} ms`);
      await delay(RETRY_MS);
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lock, { force: true });
  }
}
