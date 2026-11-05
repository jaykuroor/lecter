// F-035: the course rail in the real app. A course opened with + joins the rail and stays on it
// after a restart (the order lives in <data>/state.db, D-188); a second course joins at the end;
// dragging moves it to the top and the core keeps that order; Ctrl-1/Ctrl-2 switch courses
// through course_switch (the stored course still goes through trust); Shift-J moves a course.
//
// Every + click in every flow adds its course to the rail, and the flows of a run share one test
// home, so the rail would start with other flows' courses (some since deleted, so missing). This
// flow empties the rail while the app is closed, then adds two courses of its own, each from the
// folder dialog of a relaunched app (support/relaunch.ts); that app has no trust hook, so the flow
// answers the trust screen itself, and the second relaunch shows the rail kept across a restart.
// The embedded WebDriver sends synthetic mouse events only, so the drag is dispatched as the
// pointer events a real mouse sends.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ownCourse, relaunchWithoutTrustHook, stopRelaunched } from "../support/relaunch.ts";
import { shot } from "../support/shot.ts";

const first = (): string => ownCourse("Rail First");
const second = (): string => ownCourse("Rail Second");

interface Known {
  path: string;
  name: string;
  missing: boolean;
}

/**
 * Takes every course off the rail: the `courses` key of the test home's `<data>/state.db`. Only
 * while no app runs.
 */
function emptyRail(): void {
  const home = process.env.LECTER_TEST_HOME;
  if (!home) throw new Error("LECTER_TEST_HOME is not set: run flows through scripts/e2e-app.sh");
  const path = join(home, "data", "state.db");
  if (!existsSync(path)) return;
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
    db.exec("DELETE FROM meta WHERE key = 'courses'");
  } finally {
    db.close();
  }
}

/** `course_list`, called as the UI does. */
async function railInCore(): Promise<Known[]> {
  return browser.execute(async () => {
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string) => Promise<Known[]> } };
    return w.__TAURI_INTERNALS__.invoke("course_list");
  });
}

/** The rail's rows on screen, by their labels, and which one is the open course. */
async function railOnScreen(): Promise<{ labels: string[]; current: number }> {
  return browser.execute(() => {
    const rows = [...document.querySelectorAll<HTMLButtonElement>(".rail-courses .rail-course")];
    return {
      labels: rows.map((r) => r.getAttribute("aria-label") ?? ""),
      current: rows.findIndex((r) => r.getAttribute("aria-current") === "true"),
    };
  });
}

/** Opens the app's picked course with + and answers its trust screen and details form. */
async function addPicked(name: string): Promise<void> {
  await $("button.rail-add").click();
  await expect($(".trust")).toBeDisplayed();
  await $("button=Trust").click();
  await $("button=Later").click();
  await browser.waitUntil(async () => (await railInCore()).at(-1)?.name === name, {
    timeoutMsg: `${name} did not join the rail`,
  });
}

/** Drags row `from` onto row `to` with the pointer events a mouse sends. */
async function drag(from: number, to: number): Promise<void> {
  await browser.execute(
    (f: number, t: number) => {
      const rows = [...document.querySelectorAll<HTMLElement>(".rail-courses > li")];
      const a = rows[f]?.getBoundingClientRect();
      const b = rows[t]?.getBoundingClientRect();
      const button = rows[f]?.querySelector("button");
      if (!a || !b || !button) throw new Error("no such rail rows");
      const at = (y: number) => ({
        bubbles: true,
        isPrimary: true,
        pointerId: 1,
        button: 0,
        clientX: a.x + 30,
        clientY: y,
      });
      button.dispatchEvent(new PointerEvent("pointerdown", at(a.y + a.height / 2)));
      for (const y of [a.y + a.height / 2 - 10, b.y + b.height / 2, b.y + 4]) {
        window.dispatchEvent(new PointerEvent("pointermove", at(y)));
      }
      window.dispatchEvent(new PointerEvent("pointerup", at(b.y + 4)));
    },
    from,
    to,
  );
}

/** The open course's name under the rail (its heading, without the Read-only chip). */
async function openName(): Promise<string> {
  return browser.execute(() => document.querySelector(".course-name")?.firstChild?.textContent?.trim() ?? "");
}

/** A key on the focused element, as a keypress sends it. */
async function key(init: KeyboardEventInit): Promise<void> {
  await browser.execute((i: KeyboardEventInit) => {
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...i }));
  }, init);
}

describe("course rail", () => {
  before(() => {
    for (const c of [first(), second()]) {
      mkdirSync(join(c, "lectures"), { recursive: true });
      writeFileSync(
        join(c, "lectures", "l01.md"),
        '::: {.slide #s1 n=1 title="Variance"}\n## Variance\n\n[Variance measures spread.]{#s1b1}\n:::\n',
      );
    }
  });

  after(async () => {
    await stopRelaunched();
    for (const c of [first(), second()]) rmSync(c, { recursive: true, force: true });
    // Their folders are gone: later flows of this run don't inherit them as missing courses.
    emptyRail();
  });

  it("keeps courses across a restart, reorders by drag and Shift-J, and switches with Ctrl-1/2", async () => {
    // A rail of this flow's own: empty, then its first course.
    await relaunchWithoutTrustHook(first(), "rail-relaunch-1", emptyRail);
    expect(await railInCore()).toEqual([]);
    await addPicked("Rail First");
    expect((await railInCore()).map((c) => c.name)).toEqual(["Rail First"]);

    // A restart keeps the rail; the second course joins it at the end.
    await relaunchWithoutTrustHook(second(), "rail-relaunch-2");
    await browser.waitUntil(async () => (await railOnScreen()).labels.length === 1, {
      timeoutMsg: "the rail did not come back after the restart",
    });
    expect((await railOnScreen()).labels).toEqual(["Course Rail First"]);
    await addPicked("Rail Second");
    let screen = await railOnScreen();
    expect(screen).toEqual({ labels: ["Course Rail First", "Course Rail Second"], current: 1 });

    // Drag the second to the top: the screen and the core agree.
    await drag(1, 0);
    await browser.waitUntil(async () => (await railInCore())[0]?.name === "Rail Second", {
      timeoutMsg: "the drag did not reach the core",
    });
    screen = await railOnScreen();
    expect(screen.labels).toEqual(["Course Rail Second", "Course Rail First"]);
    await shot("rail");

    // Ctrl-2 (Cmd-2 on macOS) opens the second course on the rail, through course_switch; Ctrl-1
    // the first. The row's own hint says which modifier the app listens for.
    const mac = process.platform === "darwin";
    const mod = mac ? { metaKey: true } : { ctrlKey: true };
    const hint = await browser.execute(() =>
      document.querySelector(".rail-courses .rail-course")?.getAttribute("aria-keyshortcuts"),
    );
    expect(hint).toBe(mac ? "Meta+1" : "Control+1");
    await key({ key: "2", code: "Digit2", ...mod });
    await browser.waitUntil(async () => (await railOnScreen()).current === 1, { timeoutMsg: "Ctrl-2 did not switch" });
    expect(await openName()).toBe("Rail First");
    await key({ key: "1", code: "Digit1", ...mod });
    await browser.waitUntil(async () => (await railOnScreen()).current === 0, { timeoutMsg: "Ctrl-1 did not switch" });
    expect(await openName()).toBe("Rail Second");

    // Shift-J on the focused first row moves it down one.
    await browser.execute(() => document.querySelector<HTMLButtonElement>(".rail-courses .rail-course")?.focus());
    await key({ key: "J", code: "KeyJ", shiftKey: true });
    await browser.waitUntil(async () => (await railInCore())[1]?.name === "Rail Second", {
      timeoutMsg: "Shift-J did not reach the core",
    });
    expect((await railOnScreen()).labels).toEqual(["Course Rail First", "Course Rail Second"]);
  });
});
