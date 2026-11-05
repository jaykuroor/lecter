// F-034: after the user trusts a course in the real app, the course details form collects its
// name, code, term, professor, icon, colour and folder mapping, pre-filled from the folder names;
// Save writes .lecter/course.jsonc with "version": 1, and the course stays trusted (saving details
// doesn't change what trust covers, so the next open doesn't ask again).
//
// The form follows the user's own Trust answer, so this flow relaunches the app without the trust
// test hook (support/relaunch.ts), with the folder dialog answering a course of its own.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ownCourse, relaunchWithoutTrustHook, stopRelaunched } from "../support/relaunch.ts";
import { shot } from "../support/shot.ts";

const course = (): string => ownCourse("STAT311 - Probability and Statistics");

/** The values of the form's fields, by label, read in one script (see tests/CLAUDE.md). */
async function fields(): Promise<Record<string, string>> {
  return browser.execute(() => {
    const out: Record<string, string> = {};
    for (const label of document.querySelectorAll<HTMLLabelElement>(".details label[for]")) {
      const input = document.getElementById(label.htmlFor) as HTMLInputElement | null;
      if (input) out[label.textContent ?? ""] = input.value;
    }
    return out;
  });
}

/** Sets a field as typing would: the embedded WebDriver's keys are synthetic and change nothing. */
async function fill(name: string, value: string): Promise<void> {
  await browser.execute(
    (n: string, v: string) => {
      const input = document.querySelector<HTMLInputElement>(`.details input[name="${n}"]`);
      if (!input) throw new Error(`no field ${n}`);
      input.value = v;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    name,
    value,
  );
}

/** `course_open` called as the UI does (the dialog hook answers this flow's course): its trust. */
async function trustNow(): Promise<string> {
  return browser.execute(async () => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<{ trust: string }> };
    };
    return (await w.__TAURI_INTERNALS__.invoke("course_open", {})).trust;
  });
}

describe("course details", () => {
  before(() => {
    const c = course();
    for (const dir of ["lectures", "slides", "sources/past-papers"]) mkdirSync(join(c, dir), { recursive: true });
    writeFileSync(
      join(c, "lectures", "l01.md"),
      '::: {.slide #s1 n=1 title="Variance"}\n## Variance\n\n[Variance measures spread.]{#s1b1}\n:::\n',
    );
    writeFileSync(join(c, "slides", "01-variance.pdf"), "synthetic");
  });

  after(async () => {
    await stopRelaunched();
    rmSync(course(), { recursive: true, force: true });
  });

  it("follows Trust, pre-filled, and Save writes course.jsonc with version 1", async () => {
    await relaunchWithoutTrustHook(course(), "course-details-relaunch");
    await $("button.course-open").click();
    await expect($(".trust")).toBeDisplayed();
    await $("button=Trust").click();

    const form = $(".details");
    await expect(form).toBeDisplayed();
    expect(await fields()).toEqual({
      Name: "Probability and Statistics",
      Code: "STAT 311",
      Term: "",
      Professor: "",
      Colour: "#3584e4",
      Icon: "S",
      Slides: "slides",
      Sources: "sources",
      Lectures: "lectures",
      "Past papers": "sources/past-papers",
    });
    // Nothing is written until Save.
    expect(existsSync(join(course(), ".lecter", "course.jsonc"))).toBe(false);
    await fill("term", "Fall 2026");
    await fill("professor", "Dr. Rivera");
    await shot("course-details");

    await $(".details button.sug").click();
    await expect(form).not.toBeDisplayed();
    const saved = JSON.parse(readFileSync(join(course(), ".lecter", "course.jsonc"), "utf8"));
    expect(saved).toEqual({
      version: 1,
      name: "Probability and Statistics",
      code: "STAT 311",
      term: "Fall 2026",
      professor: "Dr. Rivera",
      icon: "S",
      color: "#3584e4",
      folders: { slides: "slides", sources: "sources", lectures: "lectures", pastPapers: "sources/past-papers" },
    });
    // Still trusted as it is now: opening it again doesn't ask.
    expect(await trustNow()).toBe("trusted");
  });
});
