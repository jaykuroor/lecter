// Per-process, per-thread CPU time series for the idle attribution (F-180, D-161): the app's
// processes and threads are read by tests/perf/idle_threads.py (procfs, libproc, the Win32 thread
// API) once per sample, and this file turns the snapshots into the `idle-attribution` lines.
// Everything but `snapshot` is pure, so ui/test/idle-cpu.test.ts checks it on fixed snapshots.

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Thread {
  tid: number;
  name: string;
  cpu_ns: number;
}

export interface Proc {
  pid: number;
  ppid: number;
  name: string;
  cpu_ns: number;
  threads: Thread[];
  threads_error: string;
}

export interface Snapshot {
  os: string;
  now_ms: number;
  procs: Proc[];
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const READER = join(root, "tests", "perf", "idle_threads.py");

/** Python 3 as each CI runner names it (Windows has no python3). */
export function python(): string {
  return process.env.LECTER_PY ?? (process.platform === "win32" ? "python" : "python3");
}

/** The app running `exe` and every process of its group, with their threads, now. */
export function snapshot(exe: string): Snapshot {
  return JSON.parse(execFileSync(python(), [READER, "snapshot", exe], { encoding: "utf8" })) as Snapshot;
}

/** One process across the samples: CPU ms used in each interval, and per thread name. */
export interface ProcSeries {
  pid: number;
  name: string;
  /** ms of CPU in each interval (process total, ended threads included). */
  ms: number[];
  total: number;
  /** Per thread name (threads of one name summed), busiest first. */
  threads: { name: string; count: number; ms: number[]; total: number }[];
  threadsError: string;
}

/**
 * Per-interval CPU use of every process seen in the last snapshot, between consecutive samples.
 * A process that started after the first sample counts from zero; one that ended before the last
 * is reported in `ended` (its time left with it).
 */
export function series(samples: Snapshot[]): { procs: ProcSeries[]; seconds: number; ended: string[] } {
  if (samples.length < 2) throw new Error("a series needs at least two samples");
  const first = samples[0] as Snapshot;
  const last = samples[samples.length - 1] as Snapshot;
  const at = (s: Snapshot, pid: number) => s.procs.find((p) => p.pid === pid);
  const procs = last.procs.map((p): ProcSeries => {
    const ms: number[] = [];
    const byName = new Map<string, { tids: Set<number>; ms: number[] }>();
    for (let i = 1; i < samples.length; i++) {
      const before = at(samples[i - 1] as Snapshot, p.pid);
      const after = at(samples[i] as Snapshot, p.pid);
      ms.push(after ? (after.cpu_ns - (before?.cpu_ns ?? 0)) / 1e6 : 0);
      const old = new Map((before?.threads ?? []).map((t) => [t.tid, t.cpu_ns]));
      for (const t of after?.threads ?? []) {
        const entry = byName.get(t.name) ?? { tids: new Set<number>(), ms: new Array(samples.length - 1).fill(0) };
        entry.tids.add(t.tid);
        entry.ms[i - 1] += (t.cpu_ns - (old.get(t.tid) ?? 0)) / 1e6;
        byName.set(t.name, entry);
      }
    }
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const threads = [...byName]
      .map(([name, e]) => ({ name, count: e.tids.size, ms: e.ms, total: sum(e.ms) }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    return { pid: p.pid, name: p.name, ms, total: sum(ms), threads, threadsError: p.threads_error };
  });
  procs.sort((a, b) => b.total - a.total);
  const now = new Set(last.procs.map((p) => p.pid));
  const ended = first.procs.filter((p) => !now.has(p.pid)).map((p) => `${p.name}[${p.pid}]`);
  return { procs, seconds: (last.now_ms - first.now_ms) / 1000, ended };
}

/** idle_cpu_pct: CPU of all the app's processes as a percent of one core over the window. */
export function cpuPct(s: { procs: ProcSeries[]; seconds: number }): number {
  const ms = s.procs.reduce((a, p) => a + p.total, 0);
  return (ms / 1000 / s.seconds) * 100;
}

const fmt = (xs: number[]) => xs.map((x) => x.toFixed(0)).join(" ");

/**
 * The `idle-attribution` lines for the CPU part: the total, then each process (busiest first)
 * with its per-interval series, and under it its threads that used at least `minMs` (at most
 * `top` of them), each with its series. Every line starts with `idle-attribution`.
 */
export function cpuLines(
  s: { procs: ProcSeries[]; seconds: number; ended: string[] },
  sampleS: number,
  top = 8,
  minMs = 1,
): string[] {
  const total = s.procs.reduce((a, p) => a + p.total, 0);
  const lines = [
    `idle-attribution cpu: idle_cpu_pct ${cpuPct(s).toFixed(2)} = ${total.toFixed(0)} ms over ${s.seconds.toFixed(1)} s in ${s.procs.length} processes` +
      `${s.ended.length ? ` (ended meanwhile: ${s.ended.join(", ")})` : ""}; series are ms per ${sampleS} s sample`,
  ];
  for (const p of s.procs) {
    lines.push(`idle-attribution process ${p.name}[${p.pid}] ${p.total.toFixed(0)} ms: ${fmt(p.ms)}`);
    if (p.threadsError) lines.push(`idle-attribution   threads unreadable: ${p.threadsError}`);
    const busy = p.threads.filter((t) => t.total >= minMs);
    for (const t of busy.slice(0, top)) {
      const n = t.count > 1 ? ` ×${t.count}` : "";
      lines.push(`idle-attribution   thread ${t.name}${n} ${t.total.toFixed(0)} ms: ${fmt(t.ms)}`);
    }
    const rest = busy.slice(top);
    if (rest.length) {
      const ms = rest.reduce((a, t) => a + t.total, 0);
      lines.push(`idle-attribution   ${rest.length} more threads ${ms.toFixed(0)} ms`);
    }
  }
  return lines;
}
