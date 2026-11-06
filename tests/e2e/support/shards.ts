// Which flows a CI shard runs (D-154). The e2e-app job is split into parallel shards, each with its
// own runner and app; `LECTER_E2E_SHARD=<i>/<n>` (wdio.conf.ts) picks shard i of n. Every flow in
// tests/e2e/flows/ lands in exactly one shard, so a new flow is never left out: one without a
// measured time counts as the slowest known flow until it has one.
//
// Balancing: the flows that must run alone get a shard each (cold-open measures cold start on a
// quiet machine, D-152, on Linux where it measures); the rest go slowest first to the shard with
// the least time so far (longest-processing-time, ties by name, so the plan is the same everywhere).

/**
 * Seconds per flow and OS, worker start to end, from CI run 41767214228 (D-154; the linux cold-open and the figure/skeleton lines were measured there too). Linux cold-open
 * includes its own release build (261 s of it). Refresh from a run's timings.json when a flow's
 * time moves a lot; the job summary shows them.
 */
export const SECONDS: Record<string, Record<string, number>> = {
  linux: {
    "cold-open": 271,
    idle: 751,
    "figure-frame": 20,
    skeleton: 49,
    gloss: 11,
    figure: 10,
    ime: 9,
    restart: 4,
    buffer: 2,
    find: 2,
    "open-course": 2,
    shell: 2,
    "open-folder": 1,
    // Estimated from restart.ts (one relaunch) until a run measures it.
    trust: 6,
    // Estimated from trust.ts (two relaunches and a lecture) until a run measures it.
    theme: 12,
    // Estimated from restart.ts (one relaunch) until a run measures it.
    "gtk-theme": 6,
  },
  darwin: {
    idle: 801,
    "figure-frame": 22,
    skeleton: 52,
    gloss: 12,
    figure: 10,
    ime: 10,
    restart: 6,
    buffer: 5,
    "cold-open": 2,
    find: 2,
    shell: 2,
    "open-course": 1,
    "open-folder": 1,
    // Estimated from restart.ts (one relaunch) until a run measures it.
    trust: 6,
    // Estimated from trust.ts (two relaunches and a lecture) until a run measures it.
    theme: 12,
  },
  win32: {
    idle: 903,
    "figure-frame": 20,
    skeleton: 76,
    gloss: 13,
    figure: 12,
    ime: 7,
    restart: 6,
    buffer: 4,
    find: 4,
    "open-course": 4,
    "cold-open": 3,
    "open-folder": 3,
    // Estimated from restart.ts (one relaunch) until a run measures it.
    trust: 6,
    // Estimated from trust.ts (two relaunches and a lecture) until a run measures it.
    theme: 12,
    shell: 3,
  },
};

/** Flows that get a shard to themselves on that OS. */
export const ALONE: Record<string, string[]> = { linux: ["cold-open"] };

/** `"2/4"` → `{ index: 2, total: 4 }`; anything else throws. */
export function parseShard(spec: string): { index: number; total: number } {
  const m = /^([1-9][0-9]*)\/([1-9][0-9]*)$/.exec(spec.trim());
  const index = Number(m?.[1]);
  const total = Number(m?.[2]);
  if (!m || index > total) throw new Error(`LECTER_E2E_SHARD must read <i>/<n> with 1 ≤ i ≤ n, not "${spec}"`);
  return { index, total };
}

/** Splits `flows` into `total` shards for `os`; every shard gets at least one flow. */
export function plan(flows: string[], os: string, total: number): string[][] {
  const known = SECONDS[os] ?? {};
  const slowest = Math.max(1, ...Object.values(known));
  const weight = (f: string) => Math.max(1, known[f] ?? slowest);
  const alone = (ALONE[os] ?? []).filter((f) => flows.includes(f)).sort();
  if (alone.length >= total && flows.length > alone.length) {
    throw new Error(`${total} shards leave no room beside ${alone.join(", ")}, which run alone on ${os}`);
  }
  if (flows.length < total) throw new Error(`${flows.length} flows can't fill ${total} shards`);
  const shards: { flows: string[]; seconds: number }[] = alone.map((f) => ({ flows: [f], seconds: weight(f) }));
  const open = Array.from({ length: total - alone.length }, () => ({ flows: [] as string[], seconds: 0 }));
  const rest = flows.filter((f) => !alone.includes(f)).sort((a, b) => weight(b) - weight(a) || a.localeCompare(b));
  for (const f of rest) {
    // The lightest shard so far, the earlier one on a tie. Weights are ≥ 1 s, so every shard
    // gets a flow before any gets a second.
    const target = open.reduce((best, s) => (s.seconds < best.seconds ? s : best));
    target.flows.push(f);
    target.seconds += weight(f);
  }
  return [...shards, ...open].map((s) => s.flows);
}
