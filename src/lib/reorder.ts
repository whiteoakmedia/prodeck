// Reordering, shared by the Checklists page and the dashboard Checklist widget.

/** A copy of `arr` with the element at `from` moved to index `to` (clamped). */
export function moveTo<T>(arr: T[], from: number, to: number): T[] {
  if (from < 0 || from >= arr.length) return arr;
  const t = Math.max(0, Math.min(arr.length - 1, to));
  if (t === from) return arr;
  const out = arr.slice();
  const [x] = out.splice(from, 1);
  out.splice(t, 0, x);
  return out;
}

/** Where a dragged row lands when dropped on row `over`: dropping onto the
 *  lower half of a row puts it after that row. */
export function dropIndex(from: number, over: number, lowerHalf: boolean): number {
  let to = lowerHalf ? over + 1 : over;
  if (from < to) to -= 1; // the row itself leaves its old slot first
  return to;
}
