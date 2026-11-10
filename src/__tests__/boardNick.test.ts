import { describe, expect, it } from "vitest";
import { nickProblem } from "../lib/boardNick";
import { weekKey } from "../lib/weekKey";

describe("leaderboard nicknames", () => {
  it("takes real names, including ones with rude words hidden inside", () => {
    for (const ok of ["Sam", "Mary Jo", "José", "O'Neil", "Lyrics_Guy", "Hancock", "Essex", "Grape", "Dickson", "Cam 2"]) {
      expect(nickProblem(ok), ok).toBe("");
    }
  });
  it("refuses rude ones, however they're spelled, and anything odd", () => {
    for (const bad of ["sh1t", "f u c k", "big dick", "Sex", "a", "x".repeat(17), "<script>", "http://x.co"]) {
      expect(nickProblem(bad), bad).not.toBe("");
    }
  });
});

describe("leaderboard weeks", () => {
  it("turn over Monday 08:00 UTC, after every Sunday service", () => {
    expect(weekKey(Date.parse("2026-11-16T07:59:00Z"))).toBe("2026-11-09");
    expect(weekKey(Date.parse("2026-11-16T08:00:00Z"))).toBe("2026-11-16");
  });
});
