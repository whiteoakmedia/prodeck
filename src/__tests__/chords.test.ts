import { describe, expect, it } from "vitest";
import { keyOptions } from "../lib/chords";

/**
 * Key stepping on a chart.
 *
 * keyOptions returns bare MAJOR names ("A", "Bb"), so matching a chart key
 * exactly failed for every minor key — "Am" and "F#m" were simply not in the
 * list, findIndex returned -1, and the transpose buttons did nothing at all.
 * On exactly the songs a worship leader is most likely to transpose.
 *
 * This mirrors the stepping logic in ChartSheet: split the root from the
 * quality, step the root, put the quality back.
 */
function step(current: string, dir: number): string | null {
  const keys = keyOptions(current);
  const m = /^([A-G][#b]?)(.*)$/.exec(current);
  if (!m) return null;
  const [, root, quality] = m;
  const i = keys.findIndex((k) => k === root);
  if (i < 0) return null;
  return keys[(i + dir + 12) % 12] + quality;
}

describe("key stepping", () => {
  it("steps a major key", () => {
    expect(step("C", 1)).toBe("C#");
    expect(step("C", -1)).toBe("B");
  });

  it("steps a minor key and keeps it minor", () => {
    expect(step("Am", 1)).toBe("A#m");
    expect(step("Am", -1)).toBe("G#m");
  });

  it("handles an accidental in a minor key", () => {
    expect(step("F#m", 1)).toBe("Gm");
  });

  it("wraps around the octave in both directions", () => {
    expect(step("B", 1)).toBe("C");
    expect(step("C", -1)).toBe("B");
  });

  it("returns twelve distinct options", () => {
    const ks = keyOptions("C");
    expect(ks).toHaveLength(12);
    expect(new Set(ks).size).toBe(12);
  });

  it("refuses gracefully on something that isn't a key", () => {
    expect(step("", 1)).toBeNull();
    expect(step("H", 1)).toBeNull();
  });
});
