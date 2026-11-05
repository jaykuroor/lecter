import { For, type JSX, Show } from "solid-js";
import type { TrustState } from "../../core/bindings";
import type { CourseFile } from "../../core/course";
import { ReadOnlyChip } from "../trust/TrustScreen";
import { shortDate } from "./date";
import { createRowMoves } from "./nav";
import "./Sidebar.css";

/**
 * A lecture in the sidebar: its file, and, when the core sends them, its front-matter date
 * (`YYYY-MM-DD`) and how many open items it has (open or uncertain doubts and flags,
 * 11-dashboard.md "Lectures").
 */
interface SidebarLecture extends CourseFile {
  date?: string | null;
  open?: number | null;
}

/** The open course as the sidebar shows it. */
export interface SidebarCourse {
  path: string;
  name: string;
  trust: TrustState;
  lectures: SidebarLecture[];
  slides: CourseFile[];
}

/** What a sidebar row other than a file opens: the dashboard or one of the lists. */
export type SidebarView = "dashboard" | "doubts" | "flags" | "office-hours" | "later" | "revise";

/** The lists (09-ui.md#layout), each with its leader key (10-keymap.md#leader-groups, `␣x`). */
const LISTS: { view: SidebarView; name: string; key: string; shortcut: string }[] = [
  { view: "doubts", name: "Doubts", key: "␣xx", shortcut: "Space x x" },
  { view: "flags", name: "Flags", key: "␣xf", shortcut: "Space x f" },
  { view: "office-hours", name: "Office hours", key: "␣xo", shortcut: "Space x o" },
  { view: "later", name: "Later", key: "␣xl", shortcut: "Space x l" },
  { view: "revise", name: "Revise", key: "␣xr", shortcut: "Space x r" },
];

/**
 * Enter and Space activate a row in the app's own handler: the browser's button activation runs
 * only for trusted key events, so a synthetic key (the embedded WebDriver, assistive tools) would
 * never open it. preventDefault stops a real keypress from also clicking.
 */
function onActivateKey(e: KeyboardEvent, activate: () => void): void {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  activate();
}

/**
 * The sidebar (09-ui.md#layout; Discord's channel list, neo-tree): the open course's name, then
 * Dashboard; Lectures with their date and open-item badge; Lists; Sources (the course's slide
 * files). Every row is a stop for `j`/`k`, ↑/↓, `gg`/Home and `G`/End; Enter, Space or a click
 * opens it. Dashboard and the lists open only once the app passes `onOpenView` (their views come
 * with later features); until then they show as unavailable. `shown` is the `␣e` toggle.
 */
export function Sidebar(props: {
  course: SidebarCourse | null;
  shown: boolean;
  /** The lecture in the buffer, highlighted in the list. */
  openLecture: string | null;
  /** Opens a lecture (its course-relative path) of the course (its path) in the buffer. */
  onOpenLecture: (course: string, path: string) => void;
  onOpenView?: ((view: SidebarView) => void) | undefined;
}): JSX.Element {
  const move = createRowMoves();

  function onKey(e: KeyboardEvent & { currentTarget: HTMLElement }): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>(".sidebar-row")];
    const row = (e.target as Element).closest<HTMLElement>(".sidebar-row");
    const index = row ? rows.indexOf(row) : -1;
    if (index === -1) return;
    const to = move(e.key, index, rows.length);
    if (to === null) return;
    e.preventDefault();
    if (to === "pending") return;
    (rows[to] as HTMLElement).focus();
  }

  const openView = (view: SidebarView) => props.onOpenView?.(view);
  const viewRow = (view: SidebarView) => ({
    "aria-disabled": props.onOpenView ? undefined : ("true" as const),
    onClick: () => openView(view),
    onKeyDown: (e: KeyboardEvent) => onActivateKey(e, () => openView(view)),
  });

  return (
    <div id="sidebar" class="sidebar" hidden={!props.shown}>
      <Show when={props.course}>
        {(course) => (
          <section class="course" aria-label={`Course ${course().name}`} onKeyDown={onKey}>
            <h2 class="course-name" title={course().path}>
              {course().name}
              <Show when={course().trust === "read_only"}>
                {" "}
                <ReadOnlyChip />
              </Show>
            </h2>
            <button type="button" class="sidebar-row sidebar-view" {...viewRow("dashboard")}>
              <span class="sidebar-name">Dashboard</span>
            </button>
            <Section label="Lectures" count={course().lectures.length} empty="No lectures yet">
              <For each={course().lectures}>
                {(lecture) => (
                  <li class="course-file" title={lecture.path}>
                    <LectureRow
                      lecture={lecture}
                      current={props.openLecture === lecture.path}
                      onOpen={() => props.onOpenLecture(course().path, lecture.path)}
                    />
                  </li>
                )}
              </For>
            </Section>
            <section class="course-section" aria-label="Lists">
              <h3 class="rlab">Lists</h3>
              <div class="sidebar-views">
                <For each={LISTS}>
                  {(list) => (
                    <button
                      type="button"
                      class="sidebar-row sidebar-view"
                      aria-label={list.name}
                      aria-keyshortcuts={list.shortcut}
                      {...viewRow(list.view)}
                    >
                      <span class="sidebar-name">{list.name}</span>
                      <kbd class="sidebar-key">{list.key}</kbd>
                    </button>
                  )}
                </For>
              </div>
            </section>
            <section class="course-section" aria-label="Sources">
              <h3 class="rlab">Sources</h3>
              <Section label="Slides" count={course().slides.length} empty="No slides yet" level={4}>
                <For each={course().slides}>
                  {(file) => (
                    <li class="course-file sidebar-row" title={file.path} tabIndex={-1}>
                      <span class="sidebar-name">{file.name}</span>
                    </li>
                  )}
                </For>
              </Section>
            </section>
          </section>
        )}
      </Show>
    </div>
  );
}

/** A labelled list of files with its count, or a line saying it is empty. */
function Section(props: {
  label: string;
  count: number;
  empty: string;
  level?: 3 | 4;
  children: JSX.Element;
}): JSX.Element {
  const heading = (
    <>
      {props.label} <span class="course-count">{props.count}</span>
    </>
  );
  return (
    <section class="course-section" aria-label={props.label}>
      <Show when={props.level === 4} fallback={<h3 class="rlab">{heading}</h3>}>
        <h4 class="rlab">{heading}</h4>
      </Show>
      <Show when={props.count > 0} fallback={<p class="course-empty">{props.empty}</p>}>
        <ul class="course-files">{props.children}</ul>
      </Show>
    </section>
  );
}

/** A lecture's row: its name, then its date and open-item badge when it has them. */
function LectureRow(props: { lecture: SidebarLecture; current: boolean; onOpen: () => void }): JSX.Element {
  const date = () => {
    const text = shortDate(props.lecture.date);
    return text === null ? null : { iso: props.lecture.date as string, text };
  };
  // A count that isn't a whole number above zero shows no badge.
  const open = () => {
    const n = props.lecture.open ?? 0;
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  const label = () => {
    const n = open();
    const items = n === null ? null : `${n} open ${n === 1 ? "item" : "items"}`;
    return [props.lecture.name, date()?.text, items].filter(Boolean).join(", ");
  };
  return (
    <button
      type="button"
      class="course-file-open sidebar-row"
      aria-label={label()}
      aria-current={props.current ? "page" : undefined}
      onClick={() => props.onOpen()}
      onKeyDown={(e) => onActivateKey(e, props.onOpen)}
    >
      <span class="sidebar-name">{props.lecture.name}</span>
      <Show when={date()}>
        {(d) => (
          <time class="sidebar-date" datetime={d().iso}>
            {d().text}
          </time>
        )}
      </Show>
      <Show when={open()}>
        {(n) => (
          <span class="sidebar-badge" aria-hidden="true">
            {n()}
          </span>
        )}
      </Show>
    </button>
  );
}
