import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { Sidebar, type SidebarCourse, type SidebarView } from "./Sidebar";
import { SidebarToggle } from "./SidebarToggle";

// F-036 (09-ui.md#layout): the sidebar lists Dashboard; Lectures with their date and open-item
// badges; Lists (Doubts, Flags, Office hours, Later, Revise); Sources. j/k, the arrow keys and
// Enter go through it; ␣e (or the headerbar button) shows and hides it.

const stat311: SidebarCourse = {
  path: "/courses/STAT311",
  name: "STAT311",
  trust: "trusted",
  lectures: [
    { name: "2026-09-02-l01-introduction.md", path: "lectures/2026-09-02-l01-introduction.md" },
    { name: "l02.md", path: "lectures/l02.md", date: "2026-10-23", open: 3 },
    { name: "l03.md", path: "lectures/l03.md", date: "2026-10-30", open: 0 },
    { name: "l04.md", path: "lectures/l04.md", date: "2026-02-30", open: 1 },
  ],
  slides: [
    { name: "07-covariance.pdf", path: "slides/07-covariance.pdf" },
    { name: "08-correlation.pdf", path: "slides/08-correlation.pdf" },
  ],
  sources: [{ name: "textbook.pdf", path: "sources/textbook.pdf" }],
};

interface Mounted {
  opened: string[];
  views: SidebarView[];
}

function mount(
  options: { course?: SidebarCourse | null; shown?: boolean; views?: boolean; openLecture?: string | null } = {},
): Mounted {
  const out: Mounted = { opened: [], views: [] };
  render(() => (
    <Sidebar
      course={options.course === undefined ? stat311 : options.course}
      shown={options.shown ?? true}
      openLecture={options.openLecture ?? null}
      onOpenLecture={(course, path) => out.opened.push(`${course} ${path}`)}
      onOpenView={options.views ? (view) => out.views.push(view) : undefined}
    />
  ));
  return out;
}

const course = () => screen.getByRole("region", { name: "Course STAT311" });
/** Every row j/k goes through, in order, by its first line of text. */
const rows = () => [...course().querySelectorAll<HTMLElement>(".sidebar-row")];
const rowNames = () => rows().map((r) => r.querySelector(".sidebar-name")?.textContent ?? r.textContent);

describe("Sidebar", () => {
  afterEach(cleanup);

  it("lists Dashboard, Lectures, Lists and Sources, in that order", () => {
    mount();
    const sections = within(course())
      .getAllByRole("region")
      .map((s) => s.getAttribute("aria-label"));
    expect(sections).toEqual(["Lectures", "Lists", "Sources", "Slides", "Readings"]);
    expect(rowNames()).toEqual([
      "Dashboard",
      "2026-09-02-l01-introduction.md",
      "l02.md",
      "l03.md",
      "l04.md",
      "Doubts",
      "Flags",
      "Office hours",
      "Later",
      "Revise",
      "07-covariance.pdf",
      "08-correlation.pdf",
      "textbook.pdf",
    ]);
    const lists = within(course()).getByRole("region", { name: "Lists" });
    // Each list shows its leader key (10-keymap.md#leader-groups, ␣x Lists).
    expect([...lists.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual(["␣xx", "␣xf", "␣xo", "␣xl", "␣xr"]);
    expect(
      within(lists)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-keyshortcuts")),
    ).toEqual(["Space x x", "Space x f", "Space x o", "Space x l", "Space x r"]);
    // Sources holds the slide files and the sources/ files (Readings), each under a heading.
    const sources = within(course()).getByRole("region", { name: "Sources" });
    expect(within(sources).getByRole("heading", { level: 3 }).textContent).toBe("Sources");
    expect(
      within(sources)
        .getAllByRole("heading", { level: 4 })
        .map((h) => h.textContent),
    ).toEqual(["Slides 2", "Readings 1"]);
    const readings = within(sources).getByRole("region", { name: "Readings" });
    expect(within(readings).getByRole("listitem").getAttribute("title")).toBe("sources/textbook.pdf");
    expect(within(course()).getByRole("heading", { level: 2 }).textContent).toBe("STAT311");
    const lectures = within(course()).getByRole("region", { name: "Lectures" });
    expect(within(lectures).getByRole("heading", { level: 3 }).textContent).toBe("Lectures 4");
  });

  it("shows each lecture's date and its open items, when it has them", () => {
    mount();
    const lectures = within(course()).getByRole("region", { name: "Lectures" });
    const [l01, l02, l03, l04] = within(lectures).getAllByRole("button");
    // No date and no count: just the name.
    expect(l01?.textContent).toBe("2026-09-02-l01-introduction.md");
    expect(l01?.querySelector("time")).toBeNull();
    // A date and three open items.
    expect(l02?.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-23");
    expect(l02?.querySelector("time")?.textContent).toBe("Oct 23");
    const badge = l02?.querySelector(".sidebar-badge");
    expect(badge?.textContent).toBe("3");
    expect(l02?.getAttribute("aria-label")).toBe("l02.md, Oct 23, 3 open items");
    // Nothing open: no badge.
    expect(l03?.querySelector("time")?.textContent).toBe("Oct 30");
    expect(l03?.querySelector(".sidebar-badge")).toBeNull();
    expect(l03?.getAttribute("aria-label")).toBe("l03.md, Oct 30");
    // A date that doesn't exist isn't shown; one open item is singular.
    expect(l04?.querySelector("time")).toBeNull();
    expect(l04?.getAttribute("aria-label")).toBe("l04.md, 1 open item");
  });

  it("shows no badge for a count that isn't a whole number above zero", () => {
    const odd = [2.5, -1, Number.NaN].map((open, i) => ({ name: `l${i}.md`, path: `lectures/l${i}.md`, open }));
    mount({ course: { ...stat311, lectures: odd } });
    const lectures = within(course()).getByRole("region", { name: "Lectures" });
    for (const row of within(lectures).getAllByRole("button")) {
      expect(row.querySelector(".sidebar-badge"), row.textContent ?? "").toBeNull();
      expect(row.getAttribute("aria-label")).toBe(row.textContent);
    }
  });

  it("moves only from a row: keys on the course's heading do nothing", () => {
    mount();
    const heading = within(course()).getByRole("heading", { level: 2 });
    const before = document.activeElement;
    expect(fireEvent.keyDown(heading, { key: "j" })).toBe(true);
    expect(fireEvent.keyDown(heading, { key: "G" })).toBe(true);
    expect(document.activeElement).toBe(before);
  });

  it("moves down with j and ArrowDown and up with k and ArrowUp, through every section", () => {
    mount();
    const all = rows();
    (all[0] as HTMLElement).focus();
    const seen: string[] = [];
    for (let i = 0; i < all.length - 1; i += 1) {
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: i % 2 ? "ArrowDown" : "j" });
      seen.push(document.activeElement?.textContent ?? "");
    }
    expect(seen).toEqual(all.slice(1).map((r) => r.textContent));
    // At the bottom, j stays.
    expect(fireEvent.keyDown(document.activeElement as HTMLElement, { key: "j" })).toBe(false);
    expect(document.activeElement).toBe(all.at(-1));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "k" });
    expect(document.activeElement).toBe(all.at(-2));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowUp" });
    expect(document.activeElement).toBe(all.at(-3));
  });

  it("goes to the first row with gg or Home and the last with G or End", () => {
    mount();
    const all = rows();
    (all[4] as HTMLElement).focus();
    fireEvent.keyDown(all[4] as HTMLElement, { key: "G", shiftKey: true });
    expect(document.activeElement).toBe(all.at(-1));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "g" });
    expect(document.activeElement).toBe(all.at(-1));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "g" });
    expect(document.activeElement).toBe(all[0]);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });
    expect(document.activeElement).toBe(all.at(-1));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Home" });
    expect(document.activeElement).toBe(all[0]);
  });

  it("leaves Ctrl, Cmd and Alt with j/k to the app's own keys", () => {
    mount();
    const first = rows()[0] as HTMLElement;
    first.focus();
    for (const mod of ["ctrlKey", "metaKey", "altKey"] as const) {
      expect(fireEvent.keyDown(first, { key: "j", [mod]: true }), mod).toBe(true);
      expect(document.activeElement, mod).toBe(first);
    }
  });

  it("opens a lecture with Enter, Space or a click, and marks the open one", () => {
    const out = mount({ openLecture: "lectures/l02.md" });
    const lectures = within(course()).getByRole("region", { name: "Lectures" });
    const [l01, l02] = within(lectures).getAllByRole("button");
    if (!l01 || !l02) throw new Error("no lecture rows");
    expect([l01.getAttribute("aria-current"), l02.getAttribute("aria-current")]).toEqual([null, "page"]);
    expect(fireEvent.keyDown(l02, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(l01, { key: " " })).toBe(false);
    fireEvent.click(l02);
    expect(out.opened).toEqual([
      "/courses/STAT311 lectures/l02.md",
      "/courses/STAT311 lectures/2026-09-02-l01-introduction.md",
      "/courses/STAT311 lectures/l02.md",
    ]);
  });

  it("opens the dashboard and each list with Enter or a click once the app can show them", () => {
    const out = mount({ views: true });
    const dashboard = screen.getByRole("button", { name: "Dashboard" });
    expect(dashboard.getAttribute("aria-disabled")).toBeNull();
    fireEvent.keyDown(dashboard, { key: "Enter" });
    const lists = within(course()).getByRole("region", { name: "Lists" });
    const buttons = within(lists).getAllByRole("button");
    for (const b of buttons) fireEvent.keyDown(b, { key: "Enter" });
    fireEvent.click(buttons[1] as HTMLElement);
    fireEvent.click(dashboard);
    expect(out.views).toEqual([
      "dashboard",
      "doubts",
      "flags",
      "office-hours",
      "later",
      "revise",
      "flags",
      "dashboard",
    ]);
  });

  it("marks the dashboard and lists unavailable while the app has nowhere to show them", () => {
    const out = mount();
    const dashboard = screen.getByRole("button", { name: "Dashboard" });
    expect(dashboard.getAttribute("aria-disabled")).toBe("true");
    // Enter is still taken, so the browser doesn't click the row either.
    expect(fireEvent.keyDown(dashboard, { key: "Enter" })).toBe(false);
    fireEvent.click(dashboard);
    const lists = within(course()).getByRole("region", { name: "Lists" });
    for (const b of within(lists).getAllByRole("button")) {
      expect(b.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(b);
    }
    expect(out.views).toEqual([]);
    expect(out.opened).toEqual([]);
  });

  it("lets j/k reach slide files, which don't open yet", () => {
    const out = mount();
    const slides = within(course()).getByRole("region", { name: "Slides" });
    expect(within(slides).queryAllByRole("button")).toHaveLength(0);
    const [first] = within(slides).getAllByRole("listitem");
    expect(first?.getAttribute("title")).toBe("slides/07-covariance.pdf");
    // Reached by j/k, not a Tab stop of its own (it has nothing to open yet).
    expect((first as HTMLElement).tabIndex).toBe(-1);
    (first as HTMLElement).focus();
    expect(fireEvent.keyDown(first as HTMLElement, { key: "Enter" })).toBe(true);
    fireEvent.keyDown(first as HTMLElement, { key: "k" });
    expect(document.activeElement?.textContent).toContain("Revise");
    expect(out.opened).toEqual([]);
  });

  it("says when the course has no lectures, slides or readings yet", () => {
    mount({ course: { ...stat311, lectures: [], slides: [], sources: [] } });
    expect(screen.getByText("No lectures yet")).toBeTruthy();
    expect(screen.getByText("No slides yet")).toBeTruthy();
    expect(screen.getByText("No readings yet")).toBeTruthy();
    expect(rowNames()).toEqual(["Dashboard", "Doubts", "Flags", "Office hours", "Later", "Revise"]);
  });

  // D-277 (F-047): a folder linked from slides/ that holds too many files is listed in part, with a
  // note under Slides naming it; none without one.
  it("notes a linked folder listed only in part under Slides", () => {
    mount({ course: { ...stat311, capped: ["slides/week4"] } });
    const notes = [...course().querySelectorAll(".sidebar-capped")].map((n) => n.textContent);
    expect(notes).toEqual(["slides/week4 holds too many files; only the first are listed."]);
    cleanup();
    mount();
    expect(course().querySelectorAll(".sidebar-capped")).toHaveLength(0);
  });

  it("marks a read-only course beside its name", () => {
    mount({ course: { ...stat311, trust: "read_only" } });
    expect(within(course()).getByRole("heading", { level: 2 }).textContent).toBe("STAT311 Read-only");
  });

  it("shows nothing before a course is open", () => {
    mount({ course: null });
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("is hidden, with its rows, while it is toggled off", () => {
    mount({ shown: false });
    expect(screen.queryByRole("region", { name: "Course STAT311" })).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(document.getElementById("sidebar")?.hidden).toBe(true);
  });
});

describe("SidebarToggle", () => {
  afterEach(cleanup);

  /** The toggle beside a sidebar it shows and hides, as the app wires them. */
  function wired(): HTMLElement {
    render(() => {
      const [shown, setShown] = createSignal(true);
      return (
        <>
          <SidebarToggle shown={shown()} onToggle={() => setShown(!shown())} />
          <Sidebar course={stat311} shown={shown()} openLecture={null} onOpenLecture={() => {}} />
        </>
      );
    });
    return screen.getByRole("button", { name: "Sidebar" });
  }

  it("shows and hides the sidebar on click, and says which it is", () => {
    const toggle = wired();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-controls")).toBe("sidebar");
    expect(toggle.getAttribute("aria-keyshortcuts")).toBe("Space e");
    expect(toggle.querySelector("kbd")?.textContent).toBe("␣e");
    expect(toggle.title).toBe("Hide the sidebar (␣e)");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.title).toBe("Show the sidebar (␣e)");
    expect(screen.queryByRole("region", { name: "Course STAT311" })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("region", { name: "Course STAT311" })).toBeTruthy();
  });

  // Synthetic keys (the embedded WebDriver, assistive tools) never click a button: the app does.
  it("toggles on Enter or Space on the focused button, and on no other key", () => {
    const toggle = wired();
    expect(fireEvent.keyDown(toggle, { key: "Enter" })).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(fireEvent.keyDown(toggle, { key: " " })).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    for (const key of ["e", "a", "Tab", "Escape"]) {
      expect(fireEvent.keyDown(toggle, { key }), key).toBe(true);
    }
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
});
