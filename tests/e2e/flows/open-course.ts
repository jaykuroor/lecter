// F-018: opening a course folder in the real app (02-course-folder.md). The course comes only from
// the folder dialog (LECTER_TEST_PICK answers it), its lectures/ and slides/ appear in the rail,
// and a slide linked out of the course is refused with E_NOT_TRUSTED (SEC-35).
// The key path is the focused button and Enter until `:open` arrives with the Vim layer.

import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
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

const openButton = () => $("button.course-open");
const course = () => $(`[aria-label="Course ${basename(picked())}"]`);

async function names(section: "Lectures" | "Slides"): Promise<string[]> {
  const items = await $$(`[aria-label="${section}"] li`).getElements();
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
    expect(opened?.path).toBe(realpathSync(picked()));
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
      const button = document.querySelector("button.course-open") as HTMLButtonElement | null;
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

  it("refuses a slides entry linked outside the course with E_NOT_TRUSTED", async () => {
    // A folder link: a junction on Windows, which (unlike a file symlink) needs no privilege.
    const outside = join(dirname(picked()), "outside-the-course");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "secret.pdf"), "synthetic\n");
    const link = join(picked(), "slides", "03-linked");
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
      await expect($('[role="alert"]')).toHaveText(/^slides\/03-linked points outside the course folder/);
      await shot("course-not-trusted");
    } finally {
      // Removes the link only, never its target; later flows open this course again.
      rmSync(link, { force: true });
    }
  });
});
