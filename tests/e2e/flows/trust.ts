// F-033: the first open of a folder shows the trust screen in the real app, with the counts, the
// provider, web search and the course's AGENTS.md; Open read-only marks the course and the core
// refuses indexing for it (E_NOT_TRUSTED, SEC-27); the answer is stored in trusted.jsonc.
//
// Every other flow runs with the trust test hook on, which answers the screen before it shows. This
// flow quits the service's app and relaunches it without the hook, on the same WebDriver port, as
// restart.ts does, with the folder dialog answering a course of its own. The relaunched app is the
// flow's own and is stopped in `after`; the next flow's worker finds the port closed and the
// service starts a fresh app.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ownCourse, relaunchWithoutTrustHook, stopRelaunched } from "../support/relaunch.ts";
import { shot } from "../support/shot.ts";

/** A course of this flow's own, next to the shared one, so no stored answer covers it. */
const course = (): string => ownCourse("Trust Course");

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
    await stopRelaunched();
    rmSync(course(), { recursive: true, force: true });
  });

  it("asks on the first open, and Open read-only keeps indexing off", async () => {
    // Quit the service's app (it has the hook) and start one without it.
    await relaunchWithoutTrustHook(course(), "trust-relaunch");

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
