// F-033: the first open of a folder shows the trust screen in the real app, with the counts, the
// provider, web search and the course's AGENTS.md; Open read-only marks the course and the core
// refuses indexing for it (E_NOT_TRUSTED, SEC-27); the answer is stored in trusted.jsonc.
//
// Every other flow runs with the trust test hook on, which answers the screen before it shows. This
// flow quits the service's app and relaunches it without the hook, on the same WebDriver port, as
// restart.ts does, with the folder dialog answering a course of its own. The relaunched app is the
// flow's own and is stopped in `after`; the next flow's worker finds the port closed and the
// service starts a fresh app.

import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shot } from "../support/shot.ts";
import { skipFocusCheck } from "../support/window.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const APP = join(root, "target", "debug", process.platform === "win32" ? "lecter-app.exe" : "lecter-app");
const HOOK = "LECTER_TEST_TRUST";

/** A course of this flow's own, next to the shared one, so no stored answer covers it. */
function course(): string {
  const shared = process.env.LECTER_TEST_PICK;
  if (!shared) throw new Error("LECTER_TEST_PICK is not set: run flows through scripts/e2e-app.sh");
  return join(dirname(shared), "Trust Course");
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

/** Polls `done` until it holds or `ms` pass. */
async function waitFor(done: () => Promise<boolean>, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await done())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await tick(50);
  }
}

let relaunched: ChildProcess | null = null;

/** Starts the app again without the trust hook, its folder dialog answering this flow's course. */
async function relaunchWithoutHook(): Promise<void> {
  const out = process.env.LECTER_E2E_OUT;
  const log = out ? openSync(join(out, "trust-relaunch.log"), "w") : "ignore";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LECTER_TEST_PICK: course(),
    TAURI_WEBDRIVER_PORT: String(port()),
    WDIO_EMBEDDED_SERVER: "true",
  };
  delete env[HOOK];
  relaunched = spawn(APP, [], { env, stdio: ["ignore", log, log] });
  if (typeof log === "number") closeSync(log);
  await waitFor(alive, 60_000, "the relaunched app's WebDriver server");
  await browser.reloadSession();
  // A new session: switch the service's focus check off again (wdio.conf.ts did the first one).
  await skipFocusCheck(browser);
}

/** `search_find` on `path`, called as the UI does; the core's error code, or "ok". */
async function searchCode(path: string): Promise<string> {
  const code = await browser.execute(async (p: string) => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> };
    };
    try {
      await w.__TAURI_INTERNALS__.invoke("search_find", { course: p, query: "variance" });
      return "ok";
    } catch (e) {
      return (e as { code?: string }).code ?? String(e);
    }
  }, path);
  return String(code);
}

describe("trust screen", () => {
  before(() => {
    const c = course();
    mkdirSync(join(c, "lectures"), { recursive: true });
    mkdirSync(join(c, "slides"), { recursive: true });
    writeFileSync(
      join(c, "lectures", "l01.md"),
      '::: {.slide #s1 n=1 title="Variance"}\n## Variance\n\n[Variance measures spread.]{#s1b1}\n:::\n',
    );
    writeFileSync(join(c, "slides", "01-variance.pdf"), "synthetic");
    writeFileSync(join(c, "AGENTS.md"), "Exams are proof-heavy.\n");
  });

  after(async () => {
    // End the session while its app still runs, then stop the app (see restart.ts).
    await browser.deleteSession().catch(() => undefined);
    (browser as unknown as { sessionId?: string }).sessionId = undefined;
    relaunched?.kill();
    rmSync(course(), { recursive: true, force: true });
  });

  it("asks on the first open, and Open read-only keeps indexing off", async () => {
    // Quit the service's app (it has the hook) and start one without it.
    await browser.closeWindow().catch(() => undefined);
    await waitFor(async () => !(await alive()), 30_000, "the app to quit");
    await relaunchWithoutHook();

    await $("button.course-open").click();
    const dialog = $(".trust");
    await expect(dialog).toBeDisplayed();
    await expect($(".trust-inside")).toHaveText("1 lecture · 1 slide deck · 0 sources");
    await expect($(".trust-provider")).toHaveText("sample");
    await expect($(".trust-web")).toHaveText("On");
    await expect($(".trust-item=AGENTS.md")).toBeDisplayed();
    await shot("trust-screen");

    const path = (await $(".course-name").getAttribute("title")) ?? "";
    // Not answered yet: the core refuses to index it.
    expect(await searchCode(path)).toBe("E_NOT_TRUSTED");

    await $("button=Open read-only").click();
    await expect(dialog).not.toBeDisplayed();
    await expect($(".trust-chip")).toBeDisplayed();
    expect(await searchCode(path)).toBe("E_NOT_TRUSTED");
    // Notes still open.
    await $("button.course-file-open=l01.md").click();
    await expect($(".lecture-buffer")).toHaveAttribute("data-lecture", "lectures/l01.md");
    expect(existsSync(join(course(), ".lecter", "cache", "index"))).toBe(false);
    await shot("read-only");

    const home = process.env.LECTER_TEST_HOME;
    if (!home) throw new Error("LECTER_TEST_HOME is not set");
    const stored = readFileSync(join(home, "config", "trusted.jsonc"), "utf8");
    expect(stored).toContain(JSON.stringify(path));
    expect(stored).toContain('"read_only"');
  });
});
