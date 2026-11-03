// The app's processes for the real-app budgets (14-quality.md#performance-budgets), on Linux,
// macOS and Windows: tests/perf/app/procs.py reads them (procfs, libproc, the Win32 process API)
// and this file does the sums. The app is the process running this run's executable
// (LECTER_PERF_APP); its group adds the webview's processes (D-146: the app counts its RSS, the
// webview its share: Linux PSS, macOS phys_footprint, Windows private working set).

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

export interface Proc {
  pid: number;
  ppid: number;
  name: string;
  start_ms: number;
  rss: number;
  share: number | null;
  cpu_ns: number;
  threads: { tid: number; name: string; cpu_ns: number }[];
  role: "app" | "webview";
  counted: number;
}

export interface Snapshot {
  os: string;
  now_ms: number;
  procs: Proc[];
  /** Webview-named processes left out of the group (a diagnostic). */
  others: { pid: number; ppid: number; name: string; responsible: number; after_app_ms: number }[];
}

/**
 * The webview runs in processes of its own: a memory figure without them would miss most of the
 * memory, so it is no measurement. The error lists what was seen but not grouped.
 */
export function requireWebview(s: Snapshot): void {
  if (s.procs.some((p) => p.role === "webview")) return;
  throw new Error(
    `no webview process in the app's group (${s.procs.map((p) => p.name).join(", ")}); ` +
      `webview-named processes outside it: ${JSON.stringify(s.others)}`,
  );
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set: run the measurements through tests/perf/app/run.sh`);
  return v;
}

/** The app and its webview processes now. Every pid seen is noted for run.sh's quiet wait. */
export function snapshot(): Snapshot {
  const out = execFileSync(env("LECTER_PERF_PY"), [join(import.meta.dirname, "procs.py"), "snapshot", env("LECTER_PERF_APP")], {
    encoding: "utf8",
  });
  const snap = JSON.parse(out) as Snapshot;
  const pidsFile = process.env.LECTER_PERF_PIDS;
  if (pidsFile) appendFileSync(pidsFile, `${snap.procs.map((p) => p.pid).join(" ")}\n`);
  return snap;
}

const mb = (bytes: number) => bytes / 1e6;

/** When the app process started (epoch ms). */
export function appStartedMs(s: Snapshot): number {
  const app = s.procs[0];
  if (!app) throw new Error("no app process");
  return app.start_ms;
}

/**
 * The memory budget's number in MB (10^6 bytes): each app process's RSS plus each webview
 * process's share (D-146). `parts` lists every process with both figures and which one counted.
 */
export function memoryMb(s: Snapshot): { total: number; parts: string } {
  let total = 0;
  const parts = s.procs.map((p) => {
    total += p.counted;
    const share = p.share === null ? "?" : mb(p.share).toFixed(1);
    const which = p.role === "webview" ? "share" : "rss";
    return `${p.name}[${p.role}] rss ${mb(p.rss).toFixed(1)} share ${share} (counts ${which})`;
  });
  const rssAll = s.procs.reduce((a, p) => a + p.rss, 0);
  return { total: mb(total), parts: `${parts.join(", ")}; ${s.os}; rss of all ${mb(rssAll).toFixed(1)} (information only)` };
}

/**
 * CPU used between two snapshots, in ms: the total (a process that started in between counts
 * from zero; one that ended takes its time with it and is counted in `ended`), and a breakdown per
 * process, busiest first, with its busiest threads where the OS lists them (Linux).
 */
export function cpuUsed(before: Snapshot, after: Snapshot, topThreads = 4): { ms: number; ended: number; parts: string } {
  const was = new Map(before.procs.map((p) => [p.pid, p]));
  let ns = 0;
  const rows = after.procs.map((p) => {
    const b = was.get(p.pid);
    const d = p.cpu_ns - (b?.cpu_ns ?? 0);
    ns += d;
    const old = new Map((b?.threads ?? []).map((t) => [t.tid, t.cpu_ns]));
    const threads = p.threads
      .map((t) => ({ name: t.name, d: t.cpu_ns - (old.get(t.tid) ?? 0) }))
      .filter((t) => t.d > 0)
      .sort((x, y) => y.d - x.d)
      .slice(0, topThreads)
      .map((t) => `${t.name} ${(t.d / 1e6).toFixed(0)}`);
    return { d, text: `${p.name}[${p.pid}] ${(d / 1e6).toFixed(0)} ms${threads.length ? ` (${threads.join(", ")})` : ""}` };
  });
  const now = new Set(after.procs.map((p) => p.pid));
  const ended = before.procs.filter((p) => !now.has(p.pid)).length;
  rows.sort((x, y) => y.d - x.d);
  return { ms: ns / 1e6, ended, parts: rows.map((r) => r.text).join("; ") };
}
