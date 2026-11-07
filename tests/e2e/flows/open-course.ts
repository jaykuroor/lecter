// F-018: opening a course folder in the real app (02-course-folder.md). The course comes only from
// the folder dialog (LECTER_TEST_PICK answers it), its lectures/ and slides/ appear in the rail,
// and a lecture linked out of the course is refused with E_NOT_TRUSTED (SEC-35). F-047: a link in
// slides/ that leaves the course is listed, and the trust screen names it (D-167).
// The key path is the focused button and Enter until `:open` arrives with the Vim layer.

import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { ownCourse, relaunchWithoutTrustHook, stopRelaunched } from "../support/relaunch.ts";
import { shot } from "../support/shot.ts";

interface CourseFile {
  name: string;
  path: string;
}

interface CourseOpened {
  path: string;
  name: string;
  lectures: CourseFile[];
  slides: CourseFile[];
  trust: "ask" | "trusted";
}

function picked(): string {
  const dir = process.env.LECTER_TEST_PICK;
  if (!dir) throw new Error("LECTER_TEST_PICK is not set: run flows through scripts/e2e-app.sh");
  return dir;
}

/** Synthetic course files in the throwaway course folder e2e-app.sh made. */
function write(rel: string): void {
  const p = join(picked(), rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, "synthetic\n");
}

const openButton = () => $("button.rail-add");
// The panel section, not the rail row: both are labelled "Course <name>".
const course = () => $(`section[aria-label="Course ${basename(picked())}"]`);

async function names(section: "Lectures" | "Slides"): Promise<string[]> {
  // The file's name, without the date and badge a lecture row may show beside it (F-036).
  const items = await $$(`[aria-label="${section}"] li .sidebar-name`).getElements();
  const out: string[] = [];
  for (const li of items) out.push(await li.getText());
  return out;
}

describe("open course", () => {
  before(() => {
    write("lectures/2026-09-02-l01-introduction.md");
    write("lectures/2026-09-09-l02-probability.md");
    write("lectures/assets/l01/fig-1.svg");
    write("slides/01-introduction.pdf");
    write("slides/02-probability.pptx");
    write("slides/.hidden.pdf");
    write("sources/book.pdf");
  });

  it("opens only the dialog's folder, whatever the UI passes", async () => {
    await expect($('[aria-label="Document"]')).toBeDisplayed();
    const opened = (await browser.execute(() => {
      const w = window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> };
      };
      return w.__TAURI_INTERNALS__.invoke("course_open", { path: "/", dir: "/" });
    })) as CourseOpened | null;
    // `.native` resolves the way the app's canonicalize does (GetFinalPathNameByHandle on Windows,
    // realpath(3) elsewhere): the JS version keeps 8.3 short names such as RUNNER~1 from TEMP.
    expect(opened?.path).toBe(realpathSync.native(picked()));
    expect(opened?.lectures.map((f) => f.path)).toEqual([
      "lectures/2026-09-02-l01-introduction.md",
      "lectures/2026-09-09-l02-probability.md",
    ]);
    expect(opened?.slides.map((f) => f.path)).toEqual(["slides/01-introduction.pdf", "slides/02-probability.pptx"]);
  });

  it("shows the course's lectures and slides after Enter on the Open button", async () => {
    // The embedded WebDriver sends keys as synthetic KeyboardEvents to document.activeElement,
    // so the button must hold focus, and the app (not the browser's activation) handles Enter.
    const focused = await browser.execute(() => {
      const button = document.querySelector("button.rail-add") as HTMLButtonElement | null;
      button?.focus();
      return document.activeElement === button && button !== null;
    });
    expect(focused).toBe(true);
    await browser.keys("Enter");
    await expect(course()).toBeDisplayed();
    await expect(course().$("h2")).toHaveText(basename(picked()));
    expect(await names("Lectures")).toEqual(["2026-09-02-l01-introduction.md", "2026-09-09-l02-probability.md"]);
    expect(await names("Slides")).toEqual(["01-introduction.pdf", "02-probability.pptx"]);
    await shot("course-open");
  });

  it("re-lists the folder when it is opened again with the mouse", async () => {
    write("lectures/2026-09-16-l03-random-variables.md");
    await openButton().click();
    await browser.waitUntil(async () => (await names("Lectures")).length === 3, {
      timeoutMsg: "the new lecture never appeared",
    });
    expect((await names("Lectures"))[2]).toBe("2026-09-16-l03-random-variables.md");
  });

  // Lecter writes lecture files, so a lectures/ entry linked out still fails the open (D-106); only
  // links in slides/ belong to the course (D-167, F-047).
  it("refuses a lectures entry linked outside the course with E_NOT_TRUSTED", async () => {
    // A folder link: a junction on Windows, which (unlike a file symlink) needs no privilege.
    const outside = join(dirname(picked()), "outside-the-course");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "secret.pdf"), "synthetic\n");
    const link = join(picked(), "lectures", "03-linked.md");
    symlinkSync(outside, link, "junction");
    try {
      const code = await browser.execute(async () => {
        const w = window as unknown as {
          __TAURI_INTERNALS__: { invoke: (cmd: string) => Promise<unknown> };
        };
        try {
          await w.__TAURI_INTERNALS__.invoke("course_open");
          return "opened";
        } catch (e) {
          return (e as { code?: string }).code ?? "no code";
        }
      });
      expect(code).toBe("E_NOT_TRUSTED");
      await openButton().click();
      await expect($('[role="alert"]')).toHaveText(/^lectures\/03-linked.md points outside the course folder/);
      await shot("course-not-trusted");
    } finally {
      // Removes the link only, never its target; later flows open this course again.
      rmSync(link, { force: true });
    }
  });

  // F-047 criterion 1 (D-167): a folder linked from slides/ to outside the course is listed by the
  // files directly in it (hidden ones left out), not refused.
  it("lists the files of a folder linked from slides/ to outside the course", async () => {
    const outside = join(dirname(picked()), "linked-from-slides");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "week3.pdf"), "synthetic\n");
    writeFileSync(join(outside, ".hidden.pdf"), "synthetic\n");
    const link = join(picked(), "slides", "03-linked");
    symlinkSync(outside, link, "junction");
    try {
      const opened = (await browser.execute(() => {
        const w = window as unknown as {
          __TAURI_INTERNALS__: { invoke: (cmd: string) => Promise<unknown> };
        };
        return w.__TAURI_INTERNALS__.invoke("course_open");
      })) as CourseOpened | null;
      expect(opened?.slides.map((f) => f.path)).toEqual([
        "slides/01-introduction.pdf",
        "slides/02-probability.pptx",
        "slides/03-linked/week3.pdf",
      ]);
      await openButton().click();
      await browser.waitUntil(async () => (await names("Slides")).length === 3, {
        timeoutMsg: "the linked slide never appeared",
      });
      expect(await names("Slides")).toEqual(["01-introduction.pdf", "02-probability.pptx", "03-linked/week3.pdf"]);
      await shot("course-linked-slides");
    } finally {
      rmSync(link, { force: true });
    }
  });
});

// F-047 criteria 2 and 4: the trust screen of a course with a link out of it names the link and
// where it leads, before anything is read; after Trust the linked slide is listed. This part
// relaunches the app without the trust hook (as trust.ts does), so it runs last in this file.
describe("open course with a link out of it", () => {
  const own = (): string => ownCourse("Linked Course");
  const downloads = (): string => join(dirname(picked()), "Linked Downloads");
  const link = (): string => join(own(), "slides", "04-week4");

  before(() => {
    mkdirSync(join(own(), "slides"), { recursive: true });
    writeFileSync(join(own(), "slides", "01-variance.pdf"), "synthetic");
    mkdirSync(join(downloads(), "week4"), { recursive: true });
    writeFileSync(join(downloads(), "week4", "covariance.pdf"), "synthetic");
    symlinkSync(join(downloads(), "week4"), link(), "junction");
  });

  after(async () => {
    await stopRelaunched();
    // The link first, so removing the course never follows it into its target.
    rmSync(link(), { force: true });
    rmSync(own(), { recursive: true, force: true });
    rmSync(downloads(), { recursive: true, force: true });
  });

  it("names the link on the trust screen, and lists its files once trusted", async () => {
    await relaunchWithoutTrustHook(own(), "open-course-links");
    await $("button.rail-add").click();
    await expect($(".trust")).toBeDisplayed();
    const target = realpathSync.native(join(downloads(), "week4"));
    const shown = await browser.execute(() =>
      [...document.querySelectorAll(".trust-links li")].map((li) => li.textContent ?? ""),
    );
    expect(shown).toEqual([`slides/04-week4 → ${target}`]);
    await expect($(".trust-inside")).toHaveText("0 lectures · 2 slide decks · 0 sources");
    // Not trusted yet: the linked folder lists as itself and is never read (criterion 4).
    expect(await names("Slides")).toEqual(["01-variance.pdf", "04-week4"]);
    await shot("trust-links");

    await $("button=Trust").click();
    await expect($(".trust")).not.toBeDisplayed();
    await browser.waitUntil(async () => (await names("Slides")).length === 2, {
      timeoutMsg: "the linked slide never appeared",
    });
    expect(await names("Slides")).toEqual(["01-variance.pdf", "04-week4/covariance.pdf"]);
  });
});
