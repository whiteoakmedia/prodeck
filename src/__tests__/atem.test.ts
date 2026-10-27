import { describe, expect, it } from "vitest";
import { atemButtons, atemName } from "../lib/atem";
import type { AtemSnapshot } from "../lib/tauri";

/**
 * The ATEM tile mirrors the switcher's own panel: Program red, Preview green,
 * cameras first. A wrong light here means someone cuts to the wrong camera.
 */
const snap = (over: Partial<AtemSnapshot> = {}): AtemSnapshot => ({
  connected: true, ready: true, product: "ATEM Mini Pro", me: 0, mes: 1,
  program: 2, preview: 3, inTransition: false, error: null,
  inputs: [
    { id: 0, name: "Black", short: "BLK", camera: false },
    { id: 1, name: "Camera 1", short: "CAM1", camera: true },
    { id: 2, name: "Camera 2", short: "CAM2", camera: true },
    { id: 3010, name: "Media Player 1", short: "MP1", camera: false },
    { id: 3, name: "  ", short: "", camera: true },
  ],
  ...over,
});

describe("ATEM tile", () => {
  it("puts cameras first and keeps the switcher's order within each group", () => {
    expect(atemButtons(snap()).map((b) => b.id)).toEqual([1, 2, 3, 0, 3010]);
  });

  it("lights exactly one Program and one Preview", () => {
    const b = atemButtons(snap());
    expect(b.filter((x) => x.program).map((x) => x.id)).toEqual([2]);
    expect(b.filter((x) => x.preview).map((x) => x.id)).toEqual([3]);
    // The same source on both (a cut with no preview change) lights both.
    const same = atemButtons(snap({ program: 1, preview: 1 })).find((x) => x.id === 1)!;
    expect(same.program && same.preview).toBe(true);
  });

  it("never shows a blank button", () => {
    const blank = atemButtons(snap()).find((x) => x.id === 3)!;
    expect(blank.label).toBe("Source 3");
    expect(blank.short).toBe("3");
  });

  it("names what's on Program and Preview, with fallbacks", () => {
    expect(atemName(snap(), 2)).toBe("Camera 2");
    expect(atemName(snap(), 3)).toBe("Source 3");
    expect(atemName(snap(), 99)).toBe("Source 99");
    expect(atemName(snap(), null)).toBe("Nothing");
    expect(atemName(null, 2)).toBe("Nothing");
    expect(atemButtons(null)).toEqual([]);
  });
});
