// Which Next Slide leaderboard week a moment falls in. Shared by the phone
// (src/lib/nextSlideBoard.ts) and the crew server (crew-cloud/src/board.ts), so
// they always agree. Pure: no browser or Worker globals.
//
// A week starts Monday 08:00 UTC: early Monday morning in the Americas, after
// every Sunday service (Sunday evening in the Pacific is still last week).

const DAY = 86_400_000;
const SHIFT = 8 * 3_600_000;

/** "2026-11-09": the Monday that starts the week `ms` is in. */
export function weekKey(ms: number): string {
  const t = ms - SHIFT;
  const d = new Date(t);
  const dow = d.getUTCDay(); // 0 = Sunday
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((dow + 6) % 7) * DAY);
  return monday.toISOString().slice(0, 10);
}

/** When the week `ms` is in ends (the next Monday 08:00 UTC), epoch ms. */
export function weekEnds(ms: number): number {
  return Date.parse(`${weekKey(ms)}T00:00:00Z`) + 7 * DAY + SHIFT;
}
