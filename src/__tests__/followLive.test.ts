import { describe, expect, it } from "vitest";
import { followTarget } from "../lib/followLive";

// A 400px tall box over 2000px of slides; cards 60px tall.
const BOX = 400;
const H = 2000;

describe("followTarget", () => {
  it("leaves a card that's comfortably in view alone", () => {
    expect(followTarget(150, 60, BOX, 0, H)).toBeNull(); // top at 150 of 400
  });

  it("brings a card below the fold up to a third of the way down", () => {
    expect(followTarget(700, 60, BOX, 0, H)).toBe(700 - 120);
  });

  it("moves before the card reaches the bottom edge, so next slides show", () => {
    // Top at 300 of 400: still visible, but past the band.
    expect(followTarget(300, 60, BOX, 0, H)).toBe(180);
  });

  it("scrolls back up for a card above the view (a jump back to the chorus)", () => {
    expect(followTarget(100, 60, BOX, 900, H)).toBe(0);
  });

  it("never scrolls past the end", () => {
    expect(followTarget(1950, 50, BOX, 0, H)).toBe(H - BOX);
  });

  it("ignores a move of a few pixels", () => {
    expect(followTarget(30, 60, BOX, 0, H)).toBeNull(); // would clamp to 0, already there
  });

  it("does nothing in a box with no height (collapsed tile)", () => {
    expect(followTarget(700, 60, 0, 0, H)).toBeNull();
  });
});
