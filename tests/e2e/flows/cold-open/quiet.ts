// Linux procfs helpers for the cold-open flow (tests/e2e/flows/cold-open.ts): the processes of a
// running app (its binary and everything it started, such as WebKit's web and network processes),
// so the flow can wait until the service's debug app has really ended before it times a launch.
// A closed WebDriver port only means the app stopped listening; its teardown would otherwise
// compete with the measured launch for the CPU.

import { readdirSync, readFileSync, readlinkSync } from "node:fs";

/** The process's parent id and state letter from /proc/<pid>/stat, or null once it is gone. */
function stat(pid: number): { ppid: number; state: string } | null {
  try {
    const s = readFileSync(`/proc/${pid}/stat`, "utf8");
    // Fields after the command name (which may hold spaces and ')'): state, then ppid.
    const [state, ppid] = s.slice(s.lastIndexOf(")") + 2).split(" ");
    return { ppid: Number(ppid), state: state ?? "" };
  } catch {
    return null;
  }
}

function exe(pid: number): string | null {
  try {
    return readlinkSync(`/proc/${pid}/exe`);
  } catch {
    return null;
  }
}

/** Every running process of the binary `path` (also when rebuilt since: "(deleted)"), and all their descendants. */
export function processTree(path: string): number[] {
  const pids = readdirSync("/proc")
    .filter((n) => /^\d+$/.test(n))
    .map(Number);
  const parent = new Map(pids.map((p) => [p, stat(p)?.ppid ?? null]));
  const tree = new Set(pids.filter((p) => exe(p)?.startsWith(path)));
  for (let grew = true; grew; ) {
    grew = false;
    for (const [p, pp] of parent) {
      if (pp !== null && tree.has(pp) && !tree.has(p)) {
        tree.add(p);
        grew = true;
      }
    }
  }
  return [...tree];
}

/** Whether `pid` still runs: present and not a zombie (exited, waiting to be reaped). */
export function running(pid: number): boolean {
  const s = stat(pid);
  return s !== null && s.state !== "Z" && s.state !== "X";
}

/**
 * Waits until every process in `snapshot` (taken while the app ran) has ended and no process of
 * `binary`, or one it started, is left: the second check also catches processes started after
 * the snapshot, as long as their parent still runs. Limit: a process the app started after the
 * snapshot whose parent has already exited is reparented away and goes unseen; WebKit's helpers
 * exit with their parent's connection, so that leaves at most a moment of teardown.
 */
export async function quiet(binary: string, snapshot: number[], what: string, ms = 30_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (snapshot.some(running) || processTree(binary).some(running)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}'s processes to end`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
