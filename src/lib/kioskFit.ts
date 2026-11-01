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
