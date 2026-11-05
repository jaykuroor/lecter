// F-035: the course rail in the real app. A course opened with + joins the rail and stays on it
// after a restart (the order lives in <data>/state.db, D-188); a second course joins at the end;
// dragging moves it to the top and the core keeps that order; Ctrl-1/Ctrl-2 switch courses
// through course_switch (the stored course still goes through trust); Shift-J moves a course.
//
// The second course needs a second folder from the dialog, so the flow relaunches the app with
// the dialog answering a course of its own (support/relaunch.ts); that app has no trust hook, so
// the flow answers the trust screen itself. The embedded WebDriver sends synthetic mouse events
// only, so the drag is dispatched as the pointer events a real mouse sends.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ownCourse, relaunchWithoutTrustHook, stopRelaunched } from "../support/relaunch.ts";
import { shot } from "../support/shot.ts";

const course = (): string => ownCourse("Rail Course");

interface Known {
  path: string;
  name: string;
  missing: boolean;
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
    const c = course();
    mkdirSync(join(c, "lectures"), { recursive: true });
    writeFileSync(
      join(c, "lectures", "l01.md"),
      '::: {.slide #s1 n=1 title="Variance"}\n## Variance\n\n[Variance measures spread.]{#s1b1}\n:::\n',
    );
  });

  after(async () => {
    await stopRelaunched();
    rmSync(course(), { recursive: true, force: true });
  });

  it("keeps courses across a restart, reorders by drag and Shift-J, and switches with Ctrl-1/2", async () => {
    // The shared course joins the rail (other flows may have put it there already).
    await $("button.rail-add").click();
    await expect($(".course-name")).toBeDisplayed();
    const shared = (await railInCore()).at(-1);
    if (!shared) throw new Error("the opened course is not on the rail");
    expect(shared.path.endsWith("Sample Course")).toBe(true);

    // A restart keeps the rail; the second course joins it at the end.
    await relaunchWithoutTrustHook(course(), "rail-relaunch");
    await browser.waitUntil(async () => (await railOnScreen()).labels.length > 0, {
      timeoutMsg: "the rail did not come back after the restart",
    });
    expect((await railInCore()).map((c) => c.path)).toContain(shared.path);
    await $("button.rail-add").click();
    await expect($(".trust")).toBeDisplayed();
    await $("button=Trust").click();
    await $("button=Later").click();
    await browser.waitUntil(async () => (await railInCore()).at(-1)?.name === "Rail Course", {
      timeoutMsg: "the second course did not join the rail",
    });
    let screen = await railOnScreen();
    expect(screen.labels.at(-1)).toBe("Course Rail Course");
    expect(screen.current).toBe(screen.labels.length - 1);

    // Drag it to the top: the screen and the core agree.
    await drag(screen.labels.length - 1, 0);
    await browser.waitUntil(async () => (await railInCore())[0]?.name === "Rail Course", {
      timeoutMsg: "the drag did not reach the core",
    });
    screen = await railOnScreen();
    expect(screen.labels[0]).toBe("Course Rail Course");
    await shot("rail");

    // Ctrl-2 opens the second course, through course_switch; Ctrl-1 the first again.
    const second = screen.labels[1] ?? "";
    await key({ key: "2", code: "Digit2", ctrlKey: true });
    await browser.waitUntil(async () => (await railOnScreen()).current === 1, { timeoutMsg: "Ctrl-2 did not switch" });
    expect(await openName()).toBe(second.replace(/^Course /, ""));
    await key({ key: "1", code: "Digit1", ctrlKey: true });
    await browser.waitUntil(async () => (await railOnScreen()).current === 0, { timeoutMsg: "Ctrl-1 did not switch" });
    expect(await openName()).toBe("Rail Course");

    // Shift-J on the focused first row moves it down one.
    await browser.execute(() => document.querySelector<HTMLButtonElement>(".rail-courses .rail-course")?.focus());
    await key({ key: "J", code: "KeyJ", shiftKey: true });
    await browser.waitUntil(async () => (await railInCore())[1]?.name === "Rail Course", {
      timeoutMsg: "Shift-J did not reach the core",
    });
    expect((await railOnScreen()).labels[1]).toBe("Course Rail Course");
  });
});
