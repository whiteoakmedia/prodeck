import { describe, expect, it } from "vitest";
import { kioskFit, MIN_ROW } from "../lib/kioskFit";

describe("kiosk fit", () => {
  it("stretches rows to fill a big screen", () => {
    const f = kioskFit({ vw: 1920, vh: 1080, rows: 8, reserved: 28 });
    expect(f.scale).toBe(1);
    expect(f.rowHeight).toBe(Math.floor((1080 - 28 - 7 * 14) / 8));
  });

  it("scales a tall dashboard down to fit a TV instead of cutting it off", () => {
    // The Green Room dashboard (12 rows) on a Fire TV (960 x 540).
    const f = kioskFit({ vw: 932, vh: 540, rows: 12, reserved: 28 });
    expect(f.rowHeight).toBe(MIN_ROW);
    expect(f.scale).toBeLessThan(1);
    const drawnHeight = (12 * MIN_ROW + 11 * 14) * f.scale;
    expect(drawnHeight).toBeLessThanOrEqual(540 - 28 + 0.5);
    // Laid out wider, so after scaling it still fills the width.
    expect(Math.round(f.width * f.scale)).toBe(932);
  });

  it("never divides by nothing", () => {
    expect(kioskFit({ vw: 0, vh: 0, rows: 0 }).scale).toBeGreaterThan(0);
  });
});
