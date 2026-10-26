// F-021: what is typed survives the app. The flow types into a lecture, quits the app (closing its
// window), relaunches it and sees the text (criterion 4); then types again, kills the app with
// SIGKILL mid-typing, relaunches it and checks that all but the last 250 ms of the typing came
// back from the journal (criterion 3, in the real app).
//
// The embedded WebDriver sends keys as synthetic events, which can't type text, so text goes in
// through `document.execCommand("insertText")` on the focused editor: a real DOM edit that
// CodeMirror reads like typing. The service starts the app once per run; the flow relaunches it
// itself on the same WebDriver port (TAURI_WEBDRIVER_PORT, as the service does) and reconnects
// with `reloadSession`. The relaunched app is the flow's own and is stopped in `after`; the next
// flow's worker finds the port closed and the service starts a fresh app.

import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shot } from "../support/shot.ts";

const NAME = "2026-10-26-l08-restart.md";
const STEM = "2026-10-26-l08-restart";
const BLOCK = "Variance is the covariance of a variable with itself.";
// A synthetic lecture as Lecter writes it (03-lecture-files.md). English only.
const LECTURE = [
  "---",
  "lecter: 1",
  "lecture: 8",
  "date: 2026-10-26",
  "title: Variance",
  "---",
  "",
  '::: {.slide #s1 n=1 title="Variance"}',
  "## Variance",
  "",
  `[${BLOCK}]{#s1b1}`,
  "",
  ":::",
  "",
].join("\n");
const TYPED = "Kept across a quit. ";
/** Typed before the kill, one piece at a time; the kill comes right after the last one. */
const PIECES = Array.from({ length: 40 }, (_, i) => `w${i} `);
/** Kill -9 may lose at most this much typing (14-quality.md crash_loss_ms). */
const LOSS_BUDGET_MS = 250;

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const APP = join(root, "target", "debug", process.platform === "win32" ? "lecter-app.exe" : "lecter-app");

function course(): string {
  const dir = process.env.LECTER_TEST_PICK;
  if (!dir) throw new Error("LECTER_TEST_PICK is not set: run flows through scripts/e2e-app.sh");
  return dir;
}

const port = (): number => browser.options.port ?? 4445;
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function alive(): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${port()}/status`, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

/** Waits until the first block reads `want`. */
async function expectFirstBlock(want: string): Promise<void> {
  await browser.waitUntil(async () => (await firstBlock()) === want, { timeout: 15_000 }).catch(() => undefined);
  expect(await firstBlock()).toBe(want);
}

/** Polls `done` until it holds or `ms` pass. */
async function waitFor(done: () => Promise<boolean>, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await done())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await tick(50);
  }
}

let relaunched: ChildProcess | null = null;
let launches = 0;

/** Starts the app again on the WebDriver port and reconnects the session to it. */
async function relaunch(): Promise<void> {
  launches += 1;
  const out = process.env.LECTER_E2E_OUT;
  const log = out ? openSync(join(out, `relaunch-${launches}.log`), "w") : "ignore";
  relaunched = spawn(APP, [], {
    env: { ...process.env, TAURI_WEBDRIVER_PORT: String(port()), WDIO_EMBEDDED_SERVER: "true" },
    stdio: ["ignore", log, log],
  });
  if (typeof log === "number") closeSync(log);
  await waitFor(alive, 60_000, "the relaunched app's WebDriver server");
  await browser.reloadSession();
}

/** Opens the course (the dialog answers LECTER_TEST_PICK) and the lecture, with the mouse. */
async function openLecture(): Promise<void> {
  await $("button.course-open").click();
  await $(`button.course-file-open=${NAME}`).click();
  await expect($(".lecture-buffer")).toHaveAttribute("data-lecture", `lectures/${NAME}`);
}

/** The first block's text, read in the page in one call (CodeMirror re-renders its widgets). */
function firstBlock(): Promise<string> {
  return browser.execute(() => document.querySelector(".cm-block")?.textContent ?? "");
}

/** Inserts `text` at the cursor of the focused editor, as typing does. */
async function type(text: string): Promise<void> {
  const ok = await browser.execute((t: string) => document.execCommand("insertText", false, t), text);
  if (!ok) throw new Error("the editor did not take the text");
}

/** Puts the buffer in insert mode at the start of its first block. */
async function insertMode(): Promise<void> {
  await expect($(".cm-focused-line")).toHaveText(BLOCK, { containing: true });
  await browser.keys("i");
  await expect($(".lecture-buffer")).toHaveAttribute("data-vim-mode", "insert");
}

describe("typing survives a restart", () => {
  before(() => {
    mkdirSync(join(course(), "lectures"), { recursive: true });
    writeFileSync(join(course(), "lectures", NAME), LECTURE);
  });

  after(() => {
    relaunched?.kill();
    // Other flows list this course's lectures exactly.
    rmSync(join(course(), "lectures", NAME), { force: true });
    const journal = join(course(), ".lecter", "journal");
    if (existsSync(journal)) {
      for (const f of readdirSync(journal).filter((f) => f.startsWith(STEM))) rmSync(join(journal, f), { force: true });
    }
  });

  it("types, quits, relaunches and sees the text", async () => {
    await openLecture();
    await insertMode();
    await type(TYPED);
    await expectFirstBlock(`${TYPED}${BLOCK}`);
    await browser.keys("Escape");

    // Quit: closing the last window ends the app, which saves open lectures on the way out.
    await browser.closeWindow().catch(() => undefined);
    await waitFor(async () => !(await alive()), 30_000, "the app to quit");
    expect(readFileSync(join(course(), "lectures", NAME), "utf8")).toContain(`[${TYPED}${BLOCK}]{#s1b1}`);

    await relaunch();
    await openLecture();
    await expectFirstBlock(`${TYPED}${BLOCK}`);
    await shot("after-restart");
  });

  it("keeps all but the last 250 ms of typing when the app is killed", async () => {
    await insertMode();
    const done: number[] = [];
    for (const piece of PIECES) {
      await type(piece);
      done.push(Date.now());
    }
    const killedAt = Date.now();
    relaunched?.kill("SIGKILL");
    await waitFor(async () => !(await alive()), 30_000, "the killed app to go");

    await relaunch();
    await openLecture();
    const text = await firstBlock();
    expect(text.endsWith(`${TYPED}${BLOCK}`)).toBe(true);
    // Each piece went in as one edit, so what came back is the first k pieces, for some k.
    const typed = text.slice(0, text.length - `${TYPED}${BLOCK}`.length);
    const kept = Array.from({ length: PIECES.length + 1 }, (_, k) => k).find(
      (k) => PIECES.slice(0, k).join("") === typed,
    );
    // Nothing typed more than the budget before the kill may be missing.
    const mustKeep = done.filter((t) => t <= killedAt - LOSS_BUDGET_MS).length;
    console.log(
      `crash_loss (real app): typed ${PIECES.length} pieces, kept ${kept ?? "not a prefix"}, required ${mustKeep} (typed over ${LOSS_BUDGET_MS} ms before the kill)`,
    );
    expect(kept).toBeGreaterThanOrEqual(mustKeep);
    await shot("after-kill");
  });
});
