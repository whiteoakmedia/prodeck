import { beforeEach, describe, expect, it, vi } from "vitest";
import { GOOD_MS, HYMNS, PERFECT_MS, VERDICT_TEXT, gapAfter, judge, lineDuration, missed, nextLine, onTime, readBest, saveBest, tempo, wordsLit } from "../lib/nextSlide";

describe("Next Slide", () => {
  it("judges a tap against the moment the last word lands", () => {
    const d = 3000;
    expect(judge(d, d)).toBe("perfect");
    expect(judge(d - PERFECT_MS, d)).toBe("perfect");
    expect(judge(d + PERFECT_MS + 1, d)).toBe("good");
    expect(judge(d - GOOD_MS, d)).toBe("good");
    expect(judge(d - GOOD_MS - 1, d)).toBe("early");
    expect(judge(500, d)).toBe("early");
    expect(judge(d + GOOD_MS + 1, d)).toBe("late");
    expect(onTime("perfect") && onTime("good")).toBe(true);
    expect(onTime("early") || onTime("late") || onTime("missed")).toBe(false);
  });

  it("calls it missed once the line has run well past", () => {
    expect(missed(3000 + GOOD_MS * 2, 3000)).toBe(false);
    expect(missed(3000 + GOOD_MS * 2 + 1, 3000)).toBe(true);
  });

  it("lights the words as they're sung, all of them by the end", () => {
    expect(wordsLit(0, 3000, 6)).toBe(0);
    expect(wordsLit(1, 3000, 6)).toBe(1);
    expect(wordsLit(1500, 3000, 6)).toBe(3);
    expect(wordsLit(3000, 3000, 6)).toBe(6);
    expect(wordsLit(9000, 3000, 6)).toBe(6);
  });

  it("gets quicker with every slide, and a mistake doesn't slow it back down", () => {
    expect(tempo(0, 0)).toBe(1);
    // Each slide shown speeds it up, streak or not.
    expect(lineDuration(7, 10, 0)).toBeLessThan(lineDuration(7, 5, 0));
    expect(lineDuration(7, 5, 0)).toBeLessThan(lineDuration(7, 0, 0));
    // A held streak adds a little on top.
    expect(lineDuration(7, 10, 10)).toBeLessThan(lineDuration(7, 10, 0));
    // The pause between lines shrinks too, but a mistake gets time to read.
    expect(gapAfter(true, 20, 0)).toBeLessThan(gapAfter(true, 0, 0));
    expect(gapAfter(false, 20, 0)).toBe(1400);
  });

  it("tops out at a pace a thumb can still keep", () => {
    expect(tempo(10_000, 10_000)).toBe(2.4);
    expect(lineDuration(7, 10_000, 0)).toBe(lineDuration(7, 20_000, 50));
    expect(lineDuration(1, 10_000, 10_000)).toBeGreaterThanOrEqual(750);
  });

  it("walks every hymn in order and starts over", () => {
    let p = { song: 0, line: 0 };
    let n = 0;
    do {
      p = nextLine(p.song, p.line);
      n++;
    } while (!(p.song === 0 && p.line === 0) && n < 1000);
    expect(n).toBe(HYMNS.reduce((a, h) => a + h.lines.length, 0));
  });

  it("uses plain words people can read at a glance", () => {
    for (const t of [...Object.values(VERDICT_TEXT), ...HYMNS.flatMap((h) => [h.title, ...h.lines])]) {
      expect(t).not.toMatch(/[–—!]| - /);
    }
  });

  describe("personal best", () => {
    beforeEach(() => {
      const m = new Map<string, string>();
      vi.stubGlobal("localStorage", {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, String(v)),
        removeItem: (k: string) => void m.delete(k),
      });
    });
    it("keeps the highest streak on this phone", () => {
      expect(readBest()).toBe(0);
      saveBest(5);
      saveBest(3);
      expect(readBest()).toBe(5);
      localStorage.setItem("prodeck.nextSlideBest", "nonsense");
      expect(readBest()).toBe(0);
    });
  });
});
