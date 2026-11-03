// The cold-open flow's own app (tests/e2e/flows/cold-open.ts): a release-profile build with the
// embedded WebDriver server (`--features custom-protocol,test-hooks`), in target/perf/ like the
// perf budgets (D-138), so target/release/ stays the hook-free build that release-check.sh checks.
// Each launch gets a fresh test home and a course holding only the 200-slide fixture lecture, and
// its stdout and stderr go to a file in LECTER_E2E_OUT (the evidence's app.log).

import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureLecture } from "../../../../ui/e2e/mock-core/lectures.ts";
import { processTree, quiet } from "./quiet.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const TARGET = join(root, "target", "perf");
export const APP = join(TARGET, "release", process.platform === "win32" ? "lecter-app.exe" : "lecter-app");

/** The fixture lecture's file name; the rail lists it under this name. */
export const LECTURE = "2026-10-23-l07-fixture.md";
/** The cold_open_ms fixture: 200 slides (14-quality.md#performance-budgets). */
const SLIDES = 200;

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Where this run keeps its logs: the folder scripts/e2e-app.sh saves as app.log. */
function out(): string {
  const dir = process.env.LECTER_E2E_OUT;
  if (!dir) throw new Error("LECTER_E2E_OUT is not set: run flows through scripts/e2e-app.sh");
  return dir;
}

/**
 * Builds the release app with test hooks. scripts/e2e-app.sh has built ui/dist, which the build
 * embeds. Incremental after the first time; the output goes to cold-open-build.log.
 */
export async function buildRelease(): Promise<void> {
  const log = join(out(), "cold-open-build.log");
  const fd = openSync(log, "w");
  const child = spawn(
    "cargo",
    ["build", "-q", "-p", "lecter-app", "--release", "--locked", "--features", "custom-protocol,test-hooks"],
    { cwd: root, env: { ...process.env, CARGO_TARGET_DIR: TARGET }, stdio: ["ignore", fd, fd] },
  );
  closeSync(fd);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (code !== 0) {
    const tail = readFileSync(log, "utf8").split("\n").slice(-30).join("\n");
    throw new Error(`the release build failed (exit ${code}):\n${tail}`);
  }
}

/** One launch of the release app. */
export interface Launch {
  /** Epoch ms just before the process was spawned: the start the budget counts from. */
  spawnedAt: number;
  /** The file holding the app's stdout and stderr. */
  log: string;
  child: ChildProcess;
  /** The launch's own test home and course folder (removed by `stop`). */
  dir: string;
}

const port = (): number => browser.options.port ?? 4445;

/** Whether an app's WebDriver server answers on the port. */
export async function alive(): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${port()}/status`, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

/** Polls `done` until it holds or `ms` pass. */
export async function waitFor(done: () => Promise<boolean>, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await done())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await tick(50);
  }
}

/**
 * Starts the release app on the WebDriver port with a fresh home and course, and points the
 * session at it. The port must be free (the service's debug app closed).
 */
export async function launch(n: number): Promise<Launch> {
  const dir = mkdtempSync(join(tmpdir(), "lecter-cold-open-"));
  const course = join(dir, "courses", "Perf Course");
  mkdirSync(join(dir, "home"), { recursive: true });
  mkdirSync(join(course, "lectures"), { recursive: true });
  mkdirSync(join(course, "slides"), { recursive: true });
  writeFileSync(join(course, "lectures", LECTURE), fixtureLecture(SLIDES));
  const log = join(out(), `cold-open-${n}.log`);
  const fd = openSync(log, "w");
  const env = {
    ...process.env,
    LECTER_TEST_HOME: join(dir, "home"),
    LECTER_TEST_PICK: course,
    LECTER_TEST_TRUST: "1",
    TAURI_WEBDRIVER_PORT: String(port()),
    WDIO_EMBEDDED_SERVER: "true",
  };
  const spawnedAt = Date.now();
  const child = spawn(APP, [], { env, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  await waitFor(alive, 60_000, "the release app's WebDriver server");
  await browser.reloadSession();
  return { spawnedAt, log, child, dir };
}

/**
 * Stops the launch's app and removes its folders. The `last` launch also ends its session (as
 * restart.ts does), so the runner doesn't try to; otherwise the next launch's `reloadSession`
 * replaces it.
 */
export async function stop(l: Launch, last: boolean): Promise<void> {
  if (last) {
    await browser.deleteSession().catch(() => undefined);
    (browser as unknown as { sessionId?: string }).sessionId = undefined;
  }
  // Its WebKit processes too: the next launch starts on a quiet machine.
  const procs = processTree(APP);
  l.child.kill();
  await waitFor(async () => !(await alive()), 30_000, "the release app to stop");
  await quiet(APP, procs, "the release app");
  rmSync(l.dir, { recursive: true, force: true });
}

/** The phases of `startup <phase> <ms>` (14-quality.md#performance-budgets, F-179 criterion 1). */
export const PHASES = ["window-created", "page-load-started", "shell-first-paint", "buffer-first-paint"] as const;
export type Phase = (typeof PHASES)[number];

/** The `startup <phase> <ms>` lines in an app's log, by phase; a phase logged twice is an error. */
export function startupLines(text: string): Partial<Record<Phase, number>> {
  const found: Partial<Record<Phase, number>> = {};
  for (const m of text.matchAll(/^startup ([a-z-]+) (\d+)$/gm)) {
    const phase = m[1] as Phase;
    if (!PHASES.includes(phase)) throw new Error(`unknown startup phase in the log: ${m[0]}`);
    if (phase in found) throw new Error(`startup ${phase} logged twice`);
    found[phase] = Number(m[2]);
  }
  return found;
}

/** Waits until the app's log holds every phase's line (the paints arrive by IPC after the paint). */
export async function waitForLines(log: string): Promise<Record<Phase, number>> {
  let lines: Partial<Record<Phase, number>> = {};
  await waitFor(
    async () => {
      lines = startupLines(readFileSync(log, "utf8"));
      return PHASES.every((p) => p in lines);
    },
    10_000,
    `every startup line in ${log}`,
  ).catch(() => undefined);
  const missing = PHASES.filter((p) => !(p in lines));
  if (missing.length > 0) throw new Error(`the app logged no startup line for: ${missing.join(", ")}`);
  return lines as Record<Phase, number>;
}
