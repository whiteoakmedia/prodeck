import { describe, expect, it } from "vitest";
import { isBackSwipe, navDepth, nextEntry } from "../lib/navHistory";

describe("Back goes to where you were", () => {
  it("counts the in-app steps behind each entry", () => {
    expect(navDepth(null)).toBe(0);
    expect(navDepth({ navDepth: 3 })).toBe(3);
    expect(navDepth({ navDepth: "2" })).toBe(0);
    expect(navDepth({ navDepth: -1 })).toBe(0);
  });

  it("stacks each new view one step deeper, keeping what else was there", () => {
    const first = nextEntry(null, "crew", { tab: "more", sub: "" });
    expect(first).toEqual({ crew: { tab: "more", sub: "" }, navDepth: 1 });
    const second = nextEntry({ ...first, other: 1 }, "crew", { tab: "more", sub: "leader" });
    expect(second).toEqual({ crew: { tab: "more", sub: "leader" }, navDepth: 2, other: 1 });
  });

  it("takes a swipe in from the left edge as back, and nothing else", () => {
    expect(isBackSwipe(8, 120, 10)).toBe(true);
    expect(isBackSwipe(80, 120, 10)).toBe(false); // started mid screen: a scroll or a slider
    expect(isBackSwipe(8, 40, 0)).toBe(false); // too short
    expect(isBackSwipe(8, 100, 90)).toBe(false); // mostly down: a scroll
  });
});
