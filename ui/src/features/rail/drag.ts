import { type Accessor, createSignal, onCleanup } from "solid-js";

/** How far (px) a press must move before it is a drag rather than a click. */
const DRAG_START_PX = 4;

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
 * place; Escape or a cancelled pointer drops nothing.
 */
export function createRowDrag(rects: () => DOMRect[], drop: (from: number, to: number) => void): RowDrag {
  const [state, setState] = createSignal<DragState | null>(null);
  let pending: { id: number; from: number; y: number } | null = null;
  let swallowClick = false;
  let clearSwallow: ReturnType<typeof setTimeout> | undefined;

  const target = (y: number): number => {
    const boxes = rects();
    const hit = boxes.findIndex((r) => y < r.bottom);
    return hit === -1 ? boxes.length - 1 : hit;
  };

  function stop(): void {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", onEscape, true);
    // A drag that moved is not a click, wherever the release lands. The browser's click follows
    // the release in the same task, so the flag clears in the next one.
    if (state()) {
      swallowClick = true;
      clearTimeout(clearSwallow);
      clearSwallow = setTimeout(() => {
        swallowClick = false;
      }, 0);
    }
    pending = null;
    setState(null);
  }

  function move(e: PointerEvent): void {
    if (!pending || e.pointerId !== pending.id) return;
    if (!state() && Math.abs(e.clientY - pending.y) < DRAG_START_PX) return;
    setState({ from: pending.from, to: target(e.clientY) });
  }

  function up(e: PointerEvent): void {
    if (!pending || e.pointerId !== pending.id) return;
    const current = state();
    stop();
    if (current) {
      const to = target(e.clientY);
      if (to !== current.from) drop(current.from, to);
    }
  }

  function cancel(e: PointerEvent): void {
    if (pending && e.pointerId === pending.id) stop();
  }

  function onEscape(e: KeyboardEvent): void {
    if (e.key !== "Escape") return;
    if (state()) {
      e.preventDefault();
      e.stopPropagation();
    }
    stop();
  }

  onCleanup(() => {
    stop();
    clearTimeout(clearSwallow);
  });

  return {
    state,
    press(e, index) {
      if (e.button !== 0 || !e.isPrimary || pending) return;
      pending = { id: e.pointerId, from: index, y: e.clientY };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", onEscape, true);
    },
    takeClick() {
      const swallow = swallowClick;
      swallowClick = false;
      return swallow;
    },
  };
}
