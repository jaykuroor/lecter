import { fireEvent } from "@solidjs/testing-library";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRowDrag, DRAG_START_PX, type RowDrag } from "./drag";

/** Three rows, 30px high, one under the other from y = 0. */
const rects = () => [0, 1, 2].map((i) => new DOMRect(0, i * 30, 190, 30));

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.useRealTimers();
});

function setup(): { drag: RowDrag; drops: [number, number][] } {
  const drops: [number, number][] = [];
  const drag = createRoot((d) => {
    dispose = d;
    return createRowDrag(rects, (from, to) => drops.push([from, to]));
  });
  return { drag, drops };
}

const down = (y: number, init: Partial<PointerEventInit> = {}) =>
  new PointerEvent("pointerdown", { button: 0, isPrimary: true, pointerId: 1, clientY: y, ...init });
const move = (y: number, pointerId = 1) => fireEvent.pointerMove(window, { pointerId, clientY: y });
const up = (y: number, pointerId = 1) => fireEvent.pointerUp(window, { pointerId, clientY: y });

describe("createRowDrag", () => {
  it("starts a drag once the press has moved DRAG_START_PX, and not before", () => {
    const { drag } = setup();
    drag.press(down(10), 0);
    move(10 + DRAG_START_PX - 1);
    expect(drag.state()).toBeNull();
    move(10 - DRAG_START_PX + 1);
    expect(drag.state()).toBeNull();
    move(10 + DRAG_START_PX);
    expect(drag.state()).toEqual({ from: 0, to: 0 });
    // Once dragging, any move counts, even back to the start.
    move(10);
    expect(drag.state()).toEqual({ from: 0, to: 0 });
  });

  it("lands on the row under the pointer; a row's bottom edge belongs to the next row", () => {
    const { drag, drops } = setup();
    drag.press(down(10), 0);
    move(29.5);
    expect(drag.state()?.to).toBe(0);
    move(30);
    expect(drag.state()?.to).toBe(1);
    move(89);
    expect(drag.state()?.to).toBe(2);
    // Below the last row, or above the first: that end.
    move(500);
    expect(drag.state()?.to).toBe(2);
    up(500);
    expect(drops).toEqual([[0, 2]]);
    drag.press(down(70), 2);
    move(-40);
    expect(drag.state()?.to).toBe(0);
    up(-40);
    expect(drops).toEqual([
      [0, 2],
      [2, 0],
    ]);
  });

  it("drops nothing for a press that didn't move far, or a drop in place", () => {
    const { drag, drops } = setup();
    drag.press(down(40), 1);
    up(42);
    drag.press(down(40), 1);
    move(55);
    expect(drag.state()).toEqual({ from: 1, to: 1 });
    up(55);
    expect(drops).toEqual([]);
    expect(drag.state()).toBeNull();
  });

  it("follows only the pointer that pressed, and only the primary button", () => {
    const { drag, drops } = setup();
    drag.press(down(10, { button: 2 }), 0);
    move(80);
    expect(drag.state()).toBeNull();
    drag.press(down(10, { isPrimary: false }), 0);
    move(80);
    expect(drag.state()).toBeNull();

    drag.press(down(10), 0);
    move(80, 2);
    expect(drag.state()).toBeNull();
    move(80);
    // A second press while one is held is ignored; the first one goes on.
    drag.press(down(40, { pointerId: 3 }), 1);
    expect(drag.state()).toEqual({ from: 0, to: 2 });
    up(80, 2);
    fireEvent.pointerCancel(window, { pointerId: 2 });
    expect(drag.state()).toEqual({ from: 0, to: 2 });
    up(80);
    expect(drops).toEqual([[0, 2]]);
  });

  it("stops following the pointer once the press ends", () => {
    const { drag, drops } = setup();
    drag.press(down(10), 0);
    move(80);
    up(80);
    move(40);
    expect(drag.state()).toBeNull();
    up(40);
    expect(drops).toEqual([[0, 2]]);
  });

  it("drops nothing when the pointer is cancelled", () => {
    const { drag, drops } = setup();
    drag.press(down(10), 0);
    move(80);
    fireEvent.pointerCancel(window, { pointerId: 1 });
    expect(drag.state()).toBeNull();
    up(80);
    move(80);
    expect(drag.state()).toBeNull();
    expect(drops).toEqual([]);
  });

  it("takes Escape from the focused element while dragging, and only then", () => {
    const { drag, drops } = setup();
    const field = document.createElement("input");
    document.body.append(field);
    const seen: string[] = [];
    field.addEventListener("keydown", (e) => seen.push(e.key));
    const key = (k: string) => {
      const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
      field.dispatchEvent(e);
      return e.defaultPrevented;
    };

    // Pressed but not yet dragging: Escape is the element's.
    drag.press(down(10), 0);
    expect(key("Escape")).toBe(false);
    move(80);
    expect(key("j")).toBe(false);
    expect(drag.state()).toEqual({ from: 0, to: 2 });
    expect(key("Escape")).toBe(true);
    expect(drag.state()).toBeNull();
    expect(seen).toEqual(["Escape", "j"]);
    up(80);
    expect(drops).toEqual([]);
    // After the drag, Escape is the element's again.
    expect(key("Escape")).toBe(false);
    expect(seen).toEqual(["Escape", "j", "Escape"]);
    field.remove();
  });

  it("eats the click right after a drag, but not a later one", () => {
    vi.useFakeTimers();
    const { drag } = setup();
    expect(drag.takeClick()).toBe(false);
    drag.press(down(10), 0);
    up(11);
    expect(drag.takeClick()).toBe(false);

    drag.press(down(10), 0);
    move(80);
    up(80);
    expect(drag.takeClick()).toBe(true);
    expect(drag.takeClick()).toBe(false);

    // A release with no click after it (it landed elsewhere): the next task forgets it.
    drag.press(down(10), 0);
    move(80);
    up(80);
    vi.runAllTimers();
    expect(drag.takeClick()).toBe(false);

    // A cancelled drag is no click either.
    drag.press(down(10), 0);
    move(80);
    fireEvent.pointerCancel(window, { pointerId: 1 });
    expect(drag.takeClick()).toBe(true);
  });

  it("lets go of the pointer when its owner goes", () => {
    const { drag, drops } = setup();
    drag.press(down(10), 0);
    move(80);
    dispose?.();
    dispose = undefined;
    up(80);
    expect(drops).toEqual([]);
  });
});
