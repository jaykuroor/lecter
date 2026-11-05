import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { CourseRail, type RailCourse } from "./CourseRail";

const stat: RailCourse = {
  path: "/c/STAT311",
  name: "Probability and Statistics",
  icon: { kind: "text", text: "S" },
  color: "#3584e4",
};
const calc: RailCourse = {
  path: "/c/MATH221",
  name: "Calculus II",
  icon: { kind: "text", text: "C" },
  color: "#26a269",
};
const phys: RailCourse = {
  path: "/c/PHYS101",
  name: "Physics",
  icon: { kind: "image", src: "lecter://course/abc.png" },
  color: "#e66100",
};

interface Calls {
  select: string[];
  reorder: string[][];
  add: number;
}

/**
 * Mounts the rail over a live list that applies each reorder, as the app's state does: with new
 * course objects, as a list from the core would be, so the rows are drawn anew. `later` applies
 * it only when the returned `apply` runs, as after a round trip to the core.
 */
function mount(initial: RailCourse[], current: string | null = null, later = false) {
  const calls: Calls = { select: [], reorder: [], add: 0 };
  const [courses, setCourses] = createSignal(initial);
  let queued: string[] | null = null;
  const apply = () => {
    const paths = queued;
    if (paths) setCourses(paths.map((p) => ({ ...(courses().find((c) => c.path === p) as RailCourse) })));
    queued = null;
  };
  const result = render(() => (
    <CourseRail
      courses={courses()}
      current={current}
      mac={false}
      onSelect={(path) => calls.select.push(path)}
      onReorder={(paths) => {
        calls.reorder.push(paths);
        queued = paths;
        if (!later) apply();
      }}
      onAdd={() => calls.add++}
    />
  ));
  return Object.assign(calls, { apply, unmount: result.unmount });
}

/** A keydown on `el`; says whether the rail took it (prevented its default). */
function press(el: Element, init: KeyboardEventInit): boolean {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e.defaultPrevented;
}

const rows = () => screen.getAllByRole("button", { name: /^Course\b/ });
const names = () => rows().map((r) => r.getAttribute("aria-label"));
function row(i: number): HTMLElement {
  const r = rows()[i];
  if (!r) throw new Error(`no course row ${i}`);
  return r;
}
const iconOf = (i: number) => row(i).querySelector(".rail-icon") as HTMLElement;

/** Gives each course row a 30px-high box, one under the other, from y = 0. */
function layOut() {
  screen.getAllByRole("listitem").forEach((li, i) => {
    li.getBoundingClientRect = () => new DOMRect(0, i * 30, 190, 30);
  });
}

function drag(from: HTMLElement, fromY: number, toY: number) {
  fireEvent.pointerDown(from, { button: 0, isPrimary: true, pointerId: 1, clientX: 20, clientY: fromY });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 20, clientY: (fromY + toY) / 2 });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 20, clientY: toY });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 20, clientY: toY });
  // The browser follows a press and release on one element with a click.
  fireEvent.click(from);
}

describe("CourseRail", () => {
  afterEach(cleanup);

  it("shows one icon per course, in order, with its text or image and its colour", () => {
    mount([stat, calc, phys], calc.path);
    expect(names()).toEqual(["Course Probability and Statistics", "Course Calculus II", "Course Physics"]);
    expect(iconOf(0).textContent).toBe("S");
    expect(iconOf(0).style.getPropertyValue("--c")).toBe("#3584e4");
    expect(iconOf(1).textContent).toBe("C");
    expect(iconOf(1).style.getPropertyValue("--c")).toBe("#26a269");
    const img = iconOf(2).querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("lecter://course/abc.png");
    expect(img.getAttribute("alt")).toBe("");
    // The open course is marked; the others aren't.
    expect(row(1).getAttribute("aria-current")).toBe("true");
    expect(row(0).getAttribute("aria-current")).toBeNull();
    expect(row(2).getAttribute("aria-current")).toBeNull();
  });

  it("numbers the first nine courses with their Ctrl key, and shows Cmd on macOS", () => {
    const many = Array.from({ length: 10 }, (_, i): RailCourse => ({ ...stat, path: `/c/${i}`, name: `N${i}` }));
    mount(many);
    const slots = rows().map((r) => r.querySelector(".rail-slot")?.textContent ?? "");
    expect(slots).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", ""]);
    expect(row(0).getAttribute("aria-keyshortcuts")).toBe("Control+1");
    expect(row(8).getAttribute("aria-keyshortcuts")).toBe("Control+9");
    expect(row(9).getAttribute("aria-keyshortcuts")).toBeNull();
    cleanup();
    render(() => (
      <CourseRail courses={[stat]} current={null} mac onSelect={() => {}} onReorder={() => {}} onAdd={() => {}} />
    ));
    expect(row(0).getAttribute("aria-keyshortcuts")).toBe("Meta+1");
  });

  it("falls back to the accent colour and the name's first letter for what it can't show", () => {
    const odd: RailCourse[] = [
      { path: "/c/a", name: "algebra", icon: { kind: "text", text: "" }, color: "red;background:url(x)" },
      { path: "/c/b", name: "Biology", icon: { kind: "image", src: "https://example.com/i.png" }, color: "#12345" },
    ];
    mount(odd);
    const a = iconOf(0);
    const b = iconOf(1);
    expect(a.textContent).toBe("A");
    expect(a.style.getPropertyValue("--c")).toBe("");
    // An image from anywhere but the core's own protocol never loads (13-security.md).
    expect(b.querySelector("img")).toBeNull();
    expect(b.textContent).toBe("B");
    expect(b.style.getPropertyValue("--c")).toBe("");
  });

  it("shows the first letter when the course's image doesn't load", () => {
    mount([phys]);
    const icon = row(0).querySelector(".rail-icon") as HTMLElement;
    fireEvent.error(icon.querySelector("img") as HTMLImageElement);
    expect(icon.querySelector("img")).toBeNull();
    expect(icon.textContent).toBe("P");
    expect(icon.style.getPropertyValue("--c")).toBe("#e66100");
  });

  it("opens a course by click, Enter and Space", () => {
    const calls = mount([stat, calc]);
    fireEvent.click(row(1));
    fireEvent.keyDown(row(0), { key: "Enter" });
    fireEvent.keyDown(row(1), { key: " " });
    expect(calls.select).toEqual([calc.path, stat.path, calc.path]);
  });

  it("adds a course from the + button by click and by key", () => {
    const calls = mount([stat]);
    const add = screen.getByRole("button", { name: "Add a course" });
    fireEvent.click(add);
    fireEvent.keyDown(add, { key: "Enter" });
    expect(calls.add).toBe(2);
  });

  it("switches to the nth course with Ctrl-1…9 from anywhere, and ignores a slot with no course", () => {
    const calls = mount([stat, calc]);
    const elsewhere = document.createElement("input");
    document.body.append(elsewhere);
    fireEvent.keyDown(elsewhere, { key: "2", code: "Digit2", ctrlKey: true });
    fireEvent.keyDown(elsewhere, { key: "1", code: "Digit1", ctrlKey: true });
    fireEvent.keyDown(elsewhere, { key: "3", code: "Digit3", ctrlKey: true });
    expect(calls.select).toEqual([calc.path, stat.path]);
    elsewhere.remove();
  });

  it("switches by the order on screen after a reorder", () => {
    const calls = mount([stat, calc]);
    fireEvent.keyDown(row(0), { key: "J", shiftKey: true });
    fireEvent.keyDown(document.body, { key: "1", code: "Digit1", ctrlKey: true });
    expect(calls.select).toEqual([calc.path]);
  });

  it("reorders by dragging a course down or up onto another's place", () => {
    const calls = mount([stat, calc, phys]);
    layOut();
    drag(row(0), 15, 75);
    expect(calls.reorder).toEqual([[calc.path, phys.path, stat.path]]);
    expect(names()).toEqual(["Course Calculus II", "Course Physics", "Course Probability and Statistics"]);
    layOut();
    drag(row(2), 75, 40);
    expect(calls.reorder[1]).toEqual([calc.path, stat.path, phys.path]);
    // A drag isn't a click: nothing was opened.
    expect(calls.select).toEqual([]);
  });

  it("drops past either end at that end", () => {
    const calls = mount([stat, calc, phys]);
    layOut();
    drag(row(1), 45, 400);
    expect(calls.reorder).toEqual([[stat.path, phys.path, calc.path]]);
    layOut();
    drag(row(2), 75, -50);
    expect(calls.reorder[1]).toEqual([calc.path, stat.path, phys.path]);
  });

  it("treats a press that barely moves as a click, and a drop in place as no reorder", () => {
    const calls = mount([stat, calc]);
    layOut();
    drag(row(1), 45, 47);
    expect(calls.reorder).toEqual([]);
    expect(calls.select).toEqual([calc.path]);
    drag(row(0), 5, 25);
    expect(calls.reorder).toEqual([]);
    // That one moved: its click opens nothing. A real click after it does.
    expect(calls.select).toEqual([calc.path]);
    fireEvent.click(row(0));
    expect(calls.select).toEqual([calc.path, stat.path]);
  });

  it("cancels a drag with Escape or a cancelled pointer, and ignores other buttons", () => {
    const calls = mount([stat, calc]);
    layOut();
    const s = row(0);
    fireEvent.pointerDown(s, { button: 0, isPrimary: true, pointerId: 1, clientY: 15 });
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 45 });
    expect(s.closest("li")?.classList.contains("dragging")).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(s.closest("li")?.classList.contains("dragging")).toBe(false);
    fireEvent.pointerUp(window, { pointerId: 1, clientY: 45 });

    fireEvent.pointerDown(s, { button: 0, isPrimary: true, pointerId: 2, clientY: 15 });
    fireEvent.pointerMove(window, { pointerId: 2, clientY: 45 });
    fireEvent.pointerCancel(window, { pointerId: 2 });
    fireEvent.pointerUp(window, { pointerId: 2, clientY: 45 });

    fireEvent.pointerDown(s, { button: 2, isPrimary: true, pointerId: 3, clientY: 15 });
    fireEvent.pointerMove(window, { pointerId: 3, clientY: 45 });
    fireEvent.pointerUp(window, { pointerId: 3, clientY: 45 });
    expect(calls.reorder).toEqual([]);
  });

  it("marks where a dragged course will land", () => {
    mount([stat, calc, phys]);
    layOut();
    fireEvent.pointerDown(row(0), { button: 0, isPrimary: true, pointerId: 1, clientY: 15 });
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 75 });
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.dataset.drop ?? "")).toEqual(["", "", "after"]);
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 45 });
    expect(items.map((li) => li.dataset.drop ?? "")).toEqual(["", "after", ""]);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(items.map((li) => li.dataset.drop ?? "")).toEqual(["", "", ""]);
  });

  it("moves a course with Shift-J and Shift-K, keeping it focused, and stops at the ends", () => {
    const calls = mount([stat, calc, phys]);
    row(0).focus();
    fireEvent.keyDown(row(0), { key: "J", shiftKey: true });
    expect(calls.reorder).toEqual([[calc.path, stat.path, phys.path]]);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Course Probability and Statistics");
    fireEvent.keyDown(row(1), { key: "J", shiftKey: true });
    fireEvent.keyDown(row(2), { key: "J", shiftKey: true });
    expect(calls.reorder).toHaveLength(2);
    expect(calls.reorder[1]).toEqual([calc.path, phys.path, stat.path]);
    fireEvent.keyDown(row(2), { key: "K", shiftKey: true });
    expect(calls.reorder[2]).toEqual([calc.path, stat.path, phys.path]);
    fireEvent.keyDown(row(0), { key: "K", shiftKey: true });
    expect(calls.reorder).toHaveLength(3);
  });

  it("moves focus with j/k and the arrow keys, without reordering", () => {
    const calls = mount([stat, calc, phys]);
    row(0).focus();
    fireEvent.keyDown(row(0), { key: "j" });
    expect(document.activeElement).toBe(row(1));
    fireEvent.keyDown(row(1), { key: "ArrowDown" });
    expect(document.activeElement).toBe(row(2));
    fireEvent.keyDown(row(2), { key: "j" });
    expect(document.activeElement).toBe(row(2));
    fireEvent.keyDown(row(2), { key: "k" });
    expect(document.activeElement).toBe(row(1));
    fireEvent.keyDown(row(1), { key: "ArrowUp" });
    fireEvent.keyDown(row(0), { key: "ArrowUp" });
    expect(document.activeElement).toBe(row(0));
    expect(calls.reorder).toEqual([]);
    expect(calls.select).toEqual([]);
  });

  it("labels the rail's list and the hint for its keys", () => {
    mount([stat]);
    const list = screen.getByRole("list", { name: "Courses" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(row(0).getAttribute("title")).toBe("Probability and Statistics · Ctrl-1 · drag or Shift-J/K to move");
    cleanup();
    const many = Array.from({ length: 10 }, (_, i): RailCourse => ({ ...stat, path: `/c/${i}`, name: `N${i}` }));
    render(() => (
      <CourseRail courses={many} current={null} mac onSelect={() => {}} onReorder={() => {}} onAdd={() => {}} />
    ));
    expect(row(0).getAttribute("title")).toBe("N0 · Cmd-1 · drag or Shift-J/K to move");
    // The tenth course has no number key.
    expect(row(9).getAttribute("title")).toBe("N9 · drag or Shift-J/K to move");
  });

  it("keeps the moved course focused when the new order arrives later, as new rows", () => {
    const calls = mount([stat, calc, phys], null, true);
    row(0).focus();
    press(row(0), { key: "J", shiftKey: true });
    expect(calls.reorder).toEqual([[calc.path, stat.path, phys.path]]);
    // Still the old order on screen until the core answers.
    expect(names()[0]).toBe("Course Probability and Statistics");
    calls.apply();
    expect(names()).toEqual(["Course Calculus II", "Course Probability and Statistics", "Course Physics"]);
    expect(document.activeElement).toBe(row(1));
    // Only once: a later list doesn't pull focus back.
    row(2).focus();
    press(row(2), { key: "K", shiftKey: true });
    calls.apply();
    expect(document.activeElement).toBe(row(1));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Course Physics");
  });

  it("takes only its own keys on a row, and none with Ctrl, Cmd or Alt held", () => {
    const calls = mount([stat, calc]);
    row(0).focus();
    expect(press(row(0), { key: "x" })).toBe(false);
    expect(press(row(0), { key: "j", ctrlKey: true })).toBe(false);
    expect(press(row(0), { key: "J", shiftKey: true, altKey: true })).toBe(false);
    expect(press(row(0), { key: "Enter", metaKey: true })).toBe(false);
    expect(document.activeElement).toBe(row(0));
    expect(calls.reorder).toEqual([]);
    expect(calls.select).toEqual([]);
    expect(press(row(0), { key: "Enter" })).toBe(true);
    expect(press(row(0), { key: " " })).toBe(true);
    expect(press(row(0), { key: "j" })).toBe(true);
    expect(calls.select).toEqual([stat.path, stat.path]);
  });

  it("takes Ctrl-n from the focused element only for a course that exists, until it is gone", () => {
    const calls = mount([stat, calc]);
    const elsewhere = document.createElement("input");
    document.body.append(elsewhere);
    expect(press(elsewhere, { key: "2", code: "Digit2", ctrlKey: true })).toBe(true);
    expect(press(elsewhere, { key: "3", code: "Digit3", ctrlKey: true })).toBe(false);
    calls.unmount();
    expect(press(elsewhere, { key: "1", code: "Digit1", ctrlKey: true })).toBe(false);
    expect(calls.select).toEqual([calc.path]);
    elsewhere.remove();
  });

  it("adds by Space, and leaves other keys on the + button alone", () => {
    const calls = mount([stat]);
    const add = screen.getByRole("button", { name: "Add a course" });
    expect(press(add, { key: " " })).toBe(true);
    expect(press(add, { key: "Enter" })).toBe(true);
    expect(press(add, { key: "a" })).toBe(false);
    expect(calls.add).toBe(2);
  });

  it("marks the landing place above when dragging up, and nothing over its own place", () => {
    mount([stat, calc, phys]);
    layOut();
    fireEvent.pointerDown(row(2), { button: 0, isPrimary: true, pointerId: 1, clientY: 75 });
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 15 });
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.dataset.drop ?? "")).toEqual(["before", "", ""]);
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 80 });
    expect(items.map((li) => li.dataset.drop ?? "")).toEqual(["", "", ""]);
    expect(items.map((li) => li.classList.contains("dragging"))).toEqual([false, false, true]);
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 900 });
    expect(items.map((li) => li.dataset.drop ?? "")).toEqual(["", "", ""]);
    fireEvent.pointerUp(window, { pointerId: 1, clientY: 900 });
    expect(items.map((li) => li.classList.contains("dragging"))).toEqual([false, false, false]);
  });

  it("checks the colour and image whole, not just their start or end", () => {
    mount([
      { ...stat, color: "#3584e4x" },
      { ...calc, color: "x#26a269" },
      { ...phys, icon: { kind: "image", src: "https://example.com/?lecter://a.png" } },
    ]);
    expect(iconOf(0).style.getPropertyValue("--c")).toBe("");
    expect(iconOf(1).style.getPropertyValue("--c")).toBe("");
    expect(iconOf(2).querySelector("img")).toBeNull();
    expect(iconOf(2).textContent).toBe("P");
  });

  it("trims the text icon and the name, and shows ? for a course with neither", () => {
    mount([
      { ...stat, icon: { kind: "text", text: "  St " } },
      { ...calc, name: "  calculus", icon: { kind: "text", text: "   " } },
      { ...phys, name: "", icon: { kind: "text", text: "" } },
    ]);
    expect(iconOf(0).textContent).toBe("St");
    expect(iconOf(1).textContent).toBe("C");
    expect(iconOf(2).textContent).toBe("?");
  });

  it("marks a course whose folder is missing, and still lets it be picked", () => {
    const calls = mount([stat, { ...calc, missing: true }]);
    expect(names()).toEqual(["Course Probability and Statistics", "Course Calculus II (folder missing)"]);
    expect(row(1).classList.contains("missing")).toBe(true);
    expect(row(0).classList.contains("missing")).toBe(false);
    expect(row(1).getAttribute("title")).toBe("Calculus II · folder missing · Ctrl-2 · drag or Shift-J/K to move");
    fireEvent.click(row(1));
    expect(calls.select).toEqual([calc.path]);
  });

  it("holds + while a course opens, and shows the last error under the rail", () => {
    const [busy, setBusy] = createSignal(true);
    const [error, setError] = createSignal<string | null>(
      "That course folder is missing or has moved; add it again with +.",
    );
    let added = 0;
    render(() => (
      <CourseRail
        courses={[stat]}
        current={null}
        mac={false}
        busy={busy()}
        error={error()}
        onSelect={() => {}}
        onReorder={() => {}}
        onAdd={() => added++}
      />
    ));
    const add = screen.getByRole("button", { name: "Add a course" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.click(add);
    expect(added).toBe(0);
    expect(screen.getByRole("alert").textContent).toBe(
      "That course folder is missing or has moved; add it again with +.",
    );
    setBusy(false);
    setError(null);
    expect(add.disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(add);
    expect(added).toBe(1);
  });

  it("keeps the browser from dragging the icon image itself", () => {
    mount([phys]);
    expect(iconOf(0).querySelector("img")?.getAttribute("draggable")).toBe("false");
  });
});
