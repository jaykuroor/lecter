import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";
import { createRowDrag } from "./drag";
import { installCourseSlots, isMacPlatform } from "./keys";
import { moveItem } from "./order";
import "./CourseRail.css";

/** A course's icon: its short text (e.g. `S`), or an image the core serves. */
type RailIcon = { kind: "text"; text: string } | { kind: "image"; src: string };

/** One course on the rail (02-course-folder.md#course-details-coursejsonc). */
export interface RailCourse {
  /** The course folder's canonical path: the course's identity. */
  path: string;
  name: string;
  icon: RailIcon;
  /** `#rrggbb`. */
  color: string;
  /** Its folder is gone or has moved: shown dimmed; opening it says so. */
  missing?: boolean;
}

/** Only the core's own protocol serves images; nothing loads from the web (13-security.md). */
const SAFE_IMAGE = /^lecter:\/\//;
const SAFE_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * The course rail (09-ui.md#layout; styled per docs/design/components.md#rail): one row per course
 * with its number key, icon and name, then `+` to add one. Mouse: click opens, drag reorders.
 * Keys: Ctrl/Cmd-1…9 opens the nth course from anywhere; on a focused row, j/k and the arrows
 * move, Enter or Space opens, Shift-J/K moves the course down or up.
 */
export function CourseRail(props: {
  courses: RailCourse[];
  /** The open course's path. */
  current: string | null;
  onSelect: (path: string) => void;
  /** The courses' paths in their new order. */
  onReorder: (paths: string[]) => void;
  onAdd: () => void;
  /** While a course opens: `+` waits. */
  busy?: boolean;
  /** Why the last open, read or reorder failed, shown under the rail. */
  error?: string | null;
  /** Whether the course keys use Cmd (macOS); found from the platform when left out. */
  mac?: boolean;
}): JSX.Element {
  const mac = () => props.mac ?? isMacPlatform();
  // Set when the list renders, before anything below reads it.
  let list!: HTMLOListElement;
  const items = () => [...list.children] as HTMLLIElement[];
  const buttons = () => items().map((li) => li.firstElementChild as HTMLButtonElement | null);

  // The moved course keeps focus once the list shows the new order.
  let refocus: string | null = null;
  createEffect(() => {
    const index = props.courses.findIndex((c) => c.path === refocus);
    const button = buttons()[index];
    if (!button) return;
    refocus = null;
    button.focus();
  });

  function move(from: number, to: number): void {
    const paths = props.courses.map((c) => c.path);
    const next = moveItem(paths, from, to);
    if (next.every((p, i) => p === paths[i])) return;
    refocus = paths[from] as string;
    props.onReorder(next);
  }

  const drag = createRowDrag(
    () => items().map((li) => li.getBoundingClientRect()),
    (from, to) => move(from, to),
  );

  onMount(() => {
    const remove = installCourseSlots(
      window,
      (index) => {
        const course = props.courses[index];
        if (course) props.onSelect(course.path);
        return course !== undefined;
      },
      mac(),
    );
    onCleanup(remove);
  });

  function onKey(e: KeyboardEvent, index: number, path: string): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const focus = (i: number) => buttons()[i]?.focus();
    const act: Record<string, () => void> = {
      Enter: () => props.onSelect(path),
      " ": () => props.onSelect(path),
      j: () => focus(index + 1),
      ArrowDown: () => focus(index + 1),
      k: () => focus(index - 1),
      ArrowUp: () => focus(index - 1),
      J: () => move(index, index + 1),
      K: () => move(index, index - 1),
    };
    const run = act[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  }

  const dropMark = (index: number): string | undefined => {
    const d = drag.state();
    if (!d || d.to !== index) return undefined;
    if (d.to > d.from) return "after";
    if (d.to < d.from) return "before";
    return undefined;
  };

  return (
    <section class="course-rail">
      <h2 class="rlab">Courses</h2>
      <ol class="rail-courses" aria-label="Courses" ref={list}>
        <For each={props.courses}>
          {(course, index) => {
            const slot = () => (index() < 9 ? index() + 1 : null);
            const keyName = () => (mac() ? "Cmd" : "Ctrl");
            return (
              <li
                class="rail-row"
                classList={{ dragging: drag.state()?.from === index() }}
                data-drop={dropMark(index())}
              >
                <button
                  type="button"
                  class="rail-course"
                  classList={{ missing: course.missing === true }}
                  aria-label={`Course ${course.name}${course.missing ? " (folder missing)" : ""}`}
                  aria-current={props.current === course.path ? "true" : undefined}
                  aria-keyshortcuts={slot() ? `${mac() ? "Meta" : "Control"}+${slot()}` : undefined}
                  title={[
                    course.name,
                    course.missing ? "folder missing" : null,
                    slot() ? `${keyName()}-${slot()}` : null,
                    "drag or Shift-J/K to move",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  onPointerDown={(e) => drag.press(e, index())}
                  onClick={() => {
                    if (!drag.takeClick()) props.onSelect(course.path);
                  }}
                  onKeyDown={(e) => onKey(e, index(), course.path)}
                >
                  <span class="rail-slot" aria-hidden="true">
                    {slot() ?? ""}
                  </span>
                  <Icon course={course} />
                  <span class="rail-name">{course.name}</span>
                </button>
              </li>
            );
          }}
        </For>
      </ol>
      <button
        type="button"
        class="rail-add"
        aria-label="Add a course"
        title="Add a course folder"
        disabled={props.busy === true}
        onClick={() => props.onAdd()}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          props.onAdd();
        }}
      >
        <span class="rail-slot" aria-hidden="true" />
        <span class="rail-icon rail-icon-add" aria-hidden="true">
          +
        </span>
        <span class="rail-name">Add a course</span>
      </button>
      <Show when={props.error}>
        {(message) => (
          <p class="rail-error" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </section>
  );
}

/** The course's icon tile, on its colour; the name's first letter when the icon can't be shown. */
function Icon(props: { course: RailCourse }): JSX.Element {
  const color = () => (SAFE_COLOR.test(props.course.color) ? props.course.color : undefined);
  // An image that doesn't load (gone, not an image) shows the letter instead.
  const [broken, setBroken] = createSignal<string | null>(null);
  const image = () => {
    const icon = props.course.icon;
    if (icon.kind !== "image" || !SAFE_IMAGE.test(icon.src) || broken() === icon.src) return null;
    return icon.src;
  };
  const letter = () => {
    const icon = props.course.icon;
    const text = icon.kind === "text" ? icon.text.trim() : "";
    return text || [...props.course.name.trim()][0]?.toUpperCase() || "?";
  };
  return (
    <span class="rail-icon" aria-hidden="true" style={color() ? { "--c": color() } : undefined}>
      <Show when={image()} fallback={letter()}>
        {(src) => <img src={src()} alt="" draggable={false} onError={() => setBroken(src())} />}
      </Show>
    </span>
  );
}
