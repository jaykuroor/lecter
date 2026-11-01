// The app's processes, read from Linux procfs (the real-app budgets of 14-quality.md): the app is
// the process whose executable is lecter-app and whose environment carries this run's
// LECTER_TEST_HOME; its tree adds the webview's processes (WebKitWebProcess, WebKitNetworkProcess).
// macOS and Windows have no procfs: these readers throw there, and the budgets report no value
// (the nightly three-OS perf run, F-174, brings their readers).

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { basename } from "node:path";

function linuxOnly(): void {
  if (process.platform !== "linux")
    throw new Error(`process measurements read /proc: Linux only (this is ${process.platform})`);
}

function pids(): number[] {
  return readdirSync("/proc")
    .filter((d) => /^\d+$/.test(d))
    .map(Number);
}

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null; // the process is gone or isn't ours
  }
}

/** The fields of /proc/<pid>/stat after the command name, so fields[0] is field 3 (state). */
function statFields(pid: number): string[] | null {
  const stat = read(`/proc/${pid}/stat`);
  if (stat === null) return null;
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ");
}

/** The app process started for the test home `home`. */
export function appPid(home: string, exeName = "lecter-app"): number {
  linuxOnly();
  const found = pids().filter((pid) => {
    let exe: string;
    try {
      exe = readlinkSync(`/proc/${pid}/exe`);
    } catch {
      return false;
    }
    if (basename(exe.replace(/ \(deleted\)$/, "")) !== exeName) return false;
    return (read(`/proc/${pid}/environ`) ?? "").split("\0").includes(`LECTER_TEST_HOME=${home}`);
  });
  if (found.length !== 1) throw new Error(`expected one ${exeName} process for ${home}, found ${found.length}`);
  return found[0] as number;
}

/** `root` and all its descendants that are alive now. */
export function tree(root: number): number[] {
  const children = new Map<number, number[]>();
  for (const pid of pids()) {
    const f = statFields(pid);
    if (!f) continue;
    const ppid = Number(f[1]);
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  const out: number[] = [];
  const todo = [root];
  while (todo.length > 0) {
    const pid = todo.pop() as number;
    out.push(pid);
    todo.push(...(children.get(pid) ?? []));
  }
  return out;
}

/** Resident memory of `pids`, summed, in MB (10^6 bytes), and per process name. */
export function rssMb(list: number[]): { total: number; parts: string } {
  let total = 0;
  const parts: string[] = [];
  for (const pid of list) {
    const status = read(`/proc/${pid}/status`);
    const kb = status ? Number(/^VmRSS:\s+(\d+) kB$/m.exec(status)?.[1] ?? 0) : 0;
    const name = status ? (/^Name:\s+(.*)$/m.exec(status)?.[1] ?? "?") : "?";
    total += (kb * 1024) / 1e6;
    parts.push(`${name} ${((kb * 1024) / 1e6).toFixed(1)}`);
  }
  return { total, parts: parts.join(", ") };
}

/** Clock ticks per second (utime and stime are in these). */
export function clockTicks(): number {
  linuxOnly();
  const n = Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim());
  if (!Number.isFinite(n) || n <= 0) throw new Error("getconf CLK_TCK gave no number");
  return n;
}

/** CPU time (user + system, all threads) used so far by each of `pids`, in ticks. */
export function cpuTicks(list: number[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const pid of list) {
    const f = statFields(pid);
    // utime and stime are fields 14 and 15, so 11 and 12 here.
    if (f) out.set(pid, Number(f[11]) + Number(f[12]));
  }
  return out;
}

/** When `pid` started, as epoch ms (to the clock tick: 10 ms with CLK_TCK 100). */
export function startedAtMs(pid: number, ticks: number): number {
  const f = statFields(pid);
  if (!f) throw new Error(`process ${pid} is gone`);
  const startTicks = Number(f[19]); // field 22, starttime: ticks after boot
  const uptimeS = Number((read("/proc/uptime") ?? "").split(" ")[0]);
  const now = Date.now();
  return now - (uptimeS - startTicks / ticks) * 1000;
}