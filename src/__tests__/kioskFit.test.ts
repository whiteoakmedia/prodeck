import { describe, expect, it } from "vitest";
import { kioskFit, MIN_ROW, MIN_TILE_ZOOM, nextTileZoom } from "../lib/kioskFit";

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

describe("tile fit on a TV", () => {
  it("leaves a tile alone when its content fits", () => {
    expect(nextTileZoom(1, { w: 250, h: 80 }, { w: 250, h: 80 })).toBe(1);
  });

  it("shrinks Mic Assignments until it fits instead of scrolling", () => {
    // Green Room 2 on a Fire Stick: 185 px of mic cards in a 150 px tile.
    const z = nextTileZoom(1, { w: 776, h: 150 }, { w: 776, h: 185 });
    expect(z).toBeLessThan(150 / 185);
    expect(z).toBeGreaterThan(0.75);
  });

  it("fits the wider side too: SPL + RTA is too wide, not too tall", () => {
    const z = nextTileZoom(1, { w: 252, h: 205 }, { w: 310, h: 205 });
    expect(z * 310).toBeLessThanOrEqual(252);
  });

  it("never draws text too small to read across a room", () => {
    // Live Viewers' full content in a two row tile would need about 0.28.
    expect(nextTileZoom(1, { w: 151, h: 47 }, { w: 151, h: 170 })).toBe(MIN_TILE_ZOOM);
  });

  it("keeps shrinking from the zoom it's at", () => {
    // At 0.9 the content still takes 110 of 100: the next try is below 0.9 * 100/110.
    const z = nextTileZoom(0.9, { w: 300, h: 100 }, { w: 300, h: 110 });
    expect(z).toBeLessThan(0.9 * (100 / 110));
    expect(z).toBeGreaterThan(0.75);
  });

  it("ignores a tile that hasn't been laid out yet", () => {
    expect(nextTileZoom(1, { w: 0, h: 0 }, { w: 100, h: 100 })).toBe(1);
  });
});
