// The app's processes for the real-app budgets (14-quality.md#performance-budgets), on Linux,
// macOS and Windows: tests/perf/app/procs.py reads them (procfs, libproc, the Win32 process API)
// and this file does the sums. The app is the process running this run's executable
// (LECTER_PERF_APP); its group adds the webview's processes. Memory counts every process by its
// share, Lecter's own included (D-161: Linux PSS, macOS phys_footprint, Windows private working
// set). Idle CPU is measured with F-180's per-thread series (tests/e2e/flows/idle-cpu/threads.ts).

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
 * The memory budget's number in MB (10^6 bytes): every process's share (D-161). `parts` lists every
 * process with its RSS and share; the RSS of all is an information line.
 */
export function memoryMb(s: Snapshot): { total: number; parts: string } {
  let total = 0;
  const parts = s.procs.map((p) => {
    total += p.counted;
    const share = p.share === null ? "?" : mb(p.share).toFixed(1);
    return `${p.name}[${p.role}] share ${share} (rss ${mb(p.rss).toFixed(1)})`;
  });
  const rssAll = s.procs.reduce((a, p) => a + p.rss, 0);
  return {
    total: mb(total),
    parts: `${parts.join(", ")}; ${s.os}; counted by share; rss of all ${mb(rssAll).toFixed(1)} (information only)`,
  };
}
