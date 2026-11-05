import { type Accessor, createSignal, onCleanup } from "solid-js";

/** How far (px) a press must move before it is a drag rather than a click. */
export const DRAG_START_PX = 4;

/** A drag in progress: the row picked up and the row it would land on. */
export interface DragState {
  from: number;
  to: number;
}

export interface RowDrag {
  /** The drag on screen, or `null` when nothing is being dragged. */
  state: Accessor<DragState | null>;
  /** Starts watching a press on row `index` (pointer events, so mouse, pen and touch). */
  press: (e: PointerEvent, index: number) => void;
  /** Whether the click that follows a drag should be ignored; asking clears it. */
  takeClick: () => boolean;
}

/**
 * Drag to reorder the rows of a vertical list. Pointer events rather than HTML drag and drop: the
 * webview's own file-drop handling can swallow HTML drags, and these work the same for every
 * pointer. `rects` gives the rows' boxes in list order; the row under the pointer is where the
 * dragged one lands, past either end at that end. `drop(from, to)` runs on release over a new
 * place; Escape or a cancelled pointer drops nothing. Call inside a Solid owner (a component).
 */
export function createRowDrag(rects: () => DOMRect[], drop: (from: number, to: number) => void): RowDrag {
  const [state, setState] = createSignal<DragState | null>(null);
  // The press being watched: its listeners go when it ends.
  let session: AbortController | null = null;
  let swallowClick = false;

  const target = (y: number): number => {
    const boxes = rects();
    const hit = boxes.findIndex((r) => y < r.bottom);
    return hit === -1 ? boxes.length - 1 : hit;
  };

  /** Ends the press. A drag that moved is not a click, wherever the release lands. */
  function end(): void {
    session?.abort();
    session = null;
    if (!state()) return;
    setState(null);
    // The browser's click follows the release in the same task; the flag clears in the next one,
    // so a release that brings no click doesn't eat a later one.
    swallowClick = true;
    setTimeout(() => {
      swallowClick = false;
    }, 0);
  }

  onCleanup(() => session?.abort());

  function press(e: PointerEvent, from: number): void {
    if (e.button !== 0 || !e.isPrimary || session) return;
    const id = e.pointerId;
    const startY = e.clientY;
    session = new AbortController();
    const on = { signal: session.signal };
    const mine = (ev: PointerEvent) => ev.pointerId === id;

    window.addEventListener(
      "pointermove",
      (ev) => {
        if (!mine(ev) || (!state() && Math.abs(ev.clientY - startY) < DRAG_START_PX)) return;
        setState({ from, to: target(ev.clientY) });
      },
      on,
    );
    window.addEventListener(
      "pointerup",
      (ev) => {
        if (!mine(ev)) return;
        const dragging = state() !== null;
        end();
        const to = target(ev.clientY);
        if (dragging && to !== from) drop(from, to);
      },
      on,
    );
    window.addEventListener("pointercancel", (ev) => mine(ev) && end(), on);
    // Before the focused element (the buffer's Vim) sees it: Escape is the drag's while it lasts.
    window.addEventListener(
      "keydown",
      (ev) => {
        if (ev.key !== "Escape" || !state()) return;
        ev.preventDefault();
        ev.stopPropagation();
        end();
      },
      { ...on, capture: true },
    );
  }

  return {
    state,
    press,
    takeClick() {
      const swallow = swallowClick;
      swallowClick = false;
      return swallow;
    },
  };
}
