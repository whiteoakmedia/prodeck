import { describe, expect, it } from "vitest";
import { dropIndex, moveTo } from "../lib/reorder";

describe("reordering checklists and steps", () => {
  it("moves one element and leaves the rest in order", () => {
    expect(moveTo(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveTo(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveTo(["a", "b"], 1, 9)).toEqual(["a", "b"]); // clamped: already last
    expect(moveTo(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });
  it("drops above or below the row under the pointer", () => {
    // dragging "a" (0) onto the lower half of "c" (2) → after c
    expect(moveTo(["a", "b", "c", "d"], 0, dropIndex(0, 2, true))).toEqual(["b", "c", "a", "d"]);
    // dragging "d" (3) onto the upper half of "b" (1) → before b
    expect(moveTo(["a", "b", "c", "d"], 3, dropIndex(3, 1, false))).toEqual(["a", "d", "b", "c"]);
    // onto itself: no change
    expect(moveTo(["a", "b", "c"], 1, dropIndex(1, 1, false))).toEqual(["a", "b", "c"]);
  });
});
