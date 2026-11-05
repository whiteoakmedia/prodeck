// How a kiosk dashboard fills its screen (pure; tested in kioskFit.test.ts).
//
// Rows stretch to fill the height. When a dashboard has more rows than fit
// at a readable row height (a 12-row layout on a TV, whose browser is only
// 540 px tall), the whole layout is drawn at that readable size and scaled
// down evenly to fit, instead of running off the bottom of the screen. On a
// TV the browser runs at twice the pixel density, so scaled text stays sharp.

/** Shortest row worth drawing; below this tiles can't hold their content. */
export const MIN_ROW = 52;

export interface KioskFit {
  rowHeight: number;
  /** 1 = drawn at screen size; below 1 = scaled down to fit. */
  scale: number;
  /** Width to lay the grid out at, before scaling. */
  width: number;
}

export function kioskFit(o: { vw: number; vh: number; rows: number; margin?: number; reserved?: number }): KioskFit {
  const margin = o.margin ?? 14;
  const rows = Math.max(1, o.rows);
  const availH = Math.max(100, o.vh - (o.reserved ?? 0));
  const availW = Math.max(100, o.vw);
  const fit = Math.floor((availH - (rows - 1) * margin) / rows);
  if (fit >= MIN_ROW) return { rowHeight: fit, scale: 1, width: availW };
  const need = rows * MIN_ROW + (rows - 1) * margin;
  const scale = availH / need;
  return { rowHeight: MIN_ROW, scale, width: Math.round(availW / scale) };
}

// ---------------------------------------------------------------- tile fit
//
// Inside one tile: a TV can't scroll, so a tile whose content is bigger than
// its box draws that content smaller (CSS zoom, which lays it out again
// rather than blurring it) until it fits. Never below MIN_TILE_ZOOM: past
// that the words are too small to read across a room, so the tile's own
// height rules (App.css, .kiosk @container) drop its extras instead, and
// anything still left over is clipped, never a scrollbar.

export const MIN_TILE_ZOOM = 0.6;

export interface Box {
  w: number;
  h: number;
}

/**
 * The next zoom to try, given the zoom now, the room the tile has (`avail`)
 * and the room its content takes at that zoom (`used`). Returns the same
 * zoom when it already fits. A little under the exact ratio, so rounding in
 * the next layout doesn't leave it one pixel over.
 */
export function nextTileZoom(zoom: number, avail: Box, used: Box, min = MIN_TILE_ZOOM): number {
  if (avail.w <= 0 || avail.h <= 0 || used.w <= 0 || used.h <= 0) return zoom;
  const ratio = Math.min(avail.w / used.w, avail.h / used.h);
  if (ratio >= 0.995) return zoom;
  return Math.max(min, Math.round(zoom * ratio * 0.98 * 1000) / 1000);
}
