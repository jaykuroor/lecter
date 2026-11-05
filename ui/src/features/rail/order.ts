/**
 * `order` with the item at `from` moved to index `to`: what dropping a dragged course on another
 * course's place, or Shift-J/K, does to the rail. A target past either end lands at that end; a
 * source that isn't in the list changes nothing. Always a new array.
 */
export function moveItem<T>(order: readonly T[], from: number, to: number): T[] {
  const next = [...order];
  if (from < 0 || from >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(Math.min(Math.max(to, 0), next.length), 0, item as T);
  return next;
}
