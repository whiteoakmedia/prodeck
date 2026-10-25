import { describe, expect, it } from "vitest";
import { slideProgress, slideProgressText } from "../lib/slideProgress";

describe("slide progress", () => {
  it("says where the live slide is and how many are left", () => {
    expect(slideProgress(5, 25)).toEqual({ n: 6, total: 25, left: 19, last: false });
    expect(slideProgressText(slideProgress(5, 25))).toBe("6 of 25 · 19 to go");
  });
  it("flags the last slide, and the one before it", () => {
    expect(slideProgressText(slideProgress(24, 25))).toBe("25 of 25 · last slide");
    expect(slideProgress(24, 25)?.last).toBe(true);
    expect(slideProgressText(slideProgress(23, 25))).toBe("24 of 25 · 1 to go");
  });
  it("falls back to the slide number when the total is missing or doesn't fit", () => {
    expect(slideProgressText(slideProgress(5, null))).toBe("6");
    expect(slideProgressText(slideProgress(30, 25))).toBe("31");
    expect(slideProgress(null, 25)).toBeNull();
  });
});
