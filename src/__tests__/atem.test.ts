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
    expect(atemButtons(snap(), { show: [3] }).map((b) => b.id)).toEqual([1, 2, 3, 0, 3010]);
  });

  it("lights exactly one Program and one Preview", () => {
    const b = atemButtons(snap(), { show: [3] });
    expect(b.filter((x) => x.program).map((x) => x.id)).toEqual([2]);
    expect(b.filter((x) => x.preview).map((x) => x.id)).toEqual([3]);
    // The same source on both (a cut with no preview change) lights both.
    const same = atemButtons(snap({ program: 1, preview: 1 })).find((x) => x.id === 1)!;
    expect(same.program && same.preview).toBe(true);
  });

  it("never shows a blank button", () => {
    // Unnamed counts as unused, so it's hidden; shown on purpose, it still has a label.
    expect(atemButtons(snap()).find((x) => x.id === 3)).toBeUndefined();
    const blank = atemButtons(snap(), { show: [3] }).find((x) => x.id === 3)!;
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

import { atemBus, moveSource, tileMe, toggleHidden, withLabel } from "../lib/atem";

describe("ATEM tile, arranged by the church", () => {
  it("keeps the tile's own order, and adds a new source after the placed ones", () => {
    const ids = atemButtons(snap(), { order: [3010, 2], show: [3] }).map((b) => b.id);
    expect(ids).toEqual([3010, 2, 1, 3, 0]);
    // An id the switcher no longer has is skipped, not shown blank.
    expect(atemButtons(snap(), { order: [77, 1] }).map((b) => b.id)[0]).toBe(1);
  });

  it("hides sources, but shows them dimmed while editing", () => {
    expect(atemButtons(snap(), { hidden: [0, 3010], show: [3] }).map((b) => b.id)).toEqual([1, 2, 3]);
    const all = atemButtons(snap(), { hidden: [0] }, { includeHidden: true });
    expect(all.find((b) => b.id === 0)?.hidden).toBe(true);
    expect(all).toHaveLength(5);
  });

  it("uses the tile's own labels on the buttons and in the Program line", () => {
    const cfg = { labels: { "2": "Pastor" } };
    expect(atemButtons(snap(), cfg).find((b) => b.id === 2)?.label).toBe("Pastor");
    expect(atemName(snap(), 2, cfg)).toBe("Pastor");
    expect(withLabel(cfg, 2, "  ")).toEqual({});
    expect(withLabel({}, 1, " Wide ")).toEqual({ "1": "Wide" });
  });

  it("moves and toggles without losing anything", () => {
    expect(moveSource([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveSource([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3]);
    expect(moveSource([1, 2], 5, 0)).toEqual([1, 2]);
    expect(toggleHidden({ hidden: [1] }, 1, true)).toEqual({ hidden: [], show: [1] });
    expect(toggleHidden({ show: [4] }, 4, false)).toEqual({ hidden: [4], show: [] });
  });
});

describe("ATEM M/Es", () => {
  const two = snap({
    mes: 2,
    buses: [
      { program: 1, preview: 2, inTransition: false },
      { program: 2, preview: 0, inTransition: true },
    ],
    inputs: [
      { id: 0, name: "Black", short: "BLK", camera: false, meMask: 3 },
      { id: 1, name: "Camera 1", short: "CAM1", camera: true, meMask: 1 },
      { id: 2, name: "Camera 2", short: "CAM2", camera: true, meMask: 3 },
    ],
  });

  it("shows each tile its own M/E's sources and tally", () => {
    expect(atemButtons(two, { me: 1 }).map((b) => b.id)).toEqual([2, 0]);
    const b = atemButtons(two, { me: 1 });
    expect(b.find((x) => x.program)?.id).toBe(2);
    expect(b.find((x) => x.preview)?.id).toBe(0);
    expect(atemBus(two, 1).inTransition).toBe(true);
  });

  it("falls back to the default M/E when the tile's isn't on this switcher", () => {
    expect(tileMe(two, { me: 1 })).toBe(1);
    expect(tileMe(two, { me: 3 })).toBe(0);
    expect(tileMe(two, {})).toBe(0);
  });

  it("reads an older snapshot that only had the default M/E", () => {
    expect(atemBus(snap(), 0)).toEqual({ program: 2, preview: 3, inTransition: false });
    expect(atemBus(snap(), 1)).toEqual({ program: null, preview: null, inTransition: false });
  });
});

import { isPlaceholder } from "../lib/atem";

describe("unused inputs", () => {
  it("knows an input marked unused", () => {
    expect(isPlaceholder({ name: "--", short: "--" })).toBe(true);
    expect(isPlaceholder({ name: "  ", short: "" })).toBe(true);
    expect(isPlaceholder({ name: "", short: "12" })).toBe(true);
    expect(isPlaceholder({ name: "Cam 3", short: "CAM3" })).toBe(false);
    expect(isPlaceholder({ name: "", short: "CAM3" })).toBe(false);
  });

  it("hides them on the tile until someone shows one", () => {
    const s = snap({ inputs: [...snap().inputs, { id: 5, name: "--", short: "--", camera: true }] });
    expect(atemButtons(s).map((b) => b.id)).not.toContain(5);
    expect(atemButtons(s, {}, { includeHidden: true }).find((b) => b.id === 5)?.hidden).toBe(true);
    expect(atemButtons(s, { show: [5] }).map((b) => b.id)).toContain(5);
  });
});

import { dskLabel, macroButtons } from "../lib/atem";

describe("keys and macros", () => {
  const s = snap({
    dsks: [{ index: 0, onAir: true, inTransition: false, tie: false, fill: 2, key: 2 }],
    macros: [
      { index: 0, name: "Walk-in", description: "" },
      { index: 4, name: "", description: "" },
      { index: 2, name: "Sermon", description: "Cam 2" },
    ],
    macroRunning: 2,
  });

  it("names a key by what it keys", () => {
    expect(dskLabel(s, 0)).toEqual({ name: "DSK 1", source: "Camera 2" });
    expect(dskLabel(s, 3)).toEqual({ name: "DSK 4", source: "" });
  });

  it("lists macros in the tile's order, names the unnamed, marks the running one", () => {
    const b = macroButtons(s, { order: [2] });
    expect(b.map((m) => m.index)).toEqual([2, 0, 4]);
    expect(b.find((m) => m.index === 4)?.name).toBe("Macro 5");
    expect(b.find((m) => m.running)?.index).toBe(2);
    expect(macroButtons(s, { hidden: [0] }).map((m) => m.index)).toEqual([0, 4, 2].filter((i) => i !== 0));
    expect(macroButtons(s, { hidden: [0] }, { includeHidden: true })).toHaveLength(3);
    expect(macroButtons(null)).toEqual([]);
  });
});
