// Which service is happening right now, decided by the clock (pure; tested in
// serviceWindow.test.ts).
//
// Analytics used to file everything into "the selected service time", and the
// selected time only moves when the next one starts. So after the last
// service of the day, every practice run until next week (Follow Pro left on
// during rehearsals) landed in that service: a 12:30 Sunday bucket that ran
// to Wednesday with 270 minutes in it, and its tap window swallowing the
// Wednesday service's taps. Now each service has a window, from its
// scheduled start (less the pre-service grace) to the earlier of the next
// service's window and the plan's length plus an overrun allowance.
// Everything outside every window is practice, kept apart per day.

/** Pre-service slides, countdown and walk-in belong to the service. */
export const PRE_SERVICE_MS = 15 * 60 * 1000;
/** A service can run this far past its planned length and still be itself. */
export const OVERRUN_MS = 45 * 60 * 1000;
/** Plan length to assume when the plan has none. */
export const DEFAULT_PLAN_MS = 90 * 60 * 1000;

export interface ServiceSlot {
  id: string;
  /** Scheduled start, epoch ms. 0 or missing = no time set in Planning Center. */
  ts: number;
}

export interface ServiceWindow {
  id: string;
  start: number;
  /** Scheduled start (for labels and tap windows). */
  scheduled: number;
  end: number;
}

/** Each scheduled service's window, in time order; never overlapping. */
export function serviceWindows(times: ServiceSlot[], planMs: number): ServiceWindow[] {
  const length = planMs > 0 ? planMs : DEFAULT_PLAN_MS;
  const sorted = times.filter((t) => t.ts > 0).sort((a, b) => a.ts - b.ts);
  return sorted.map((t, i) => {
    const start = t.ts - PRE_SERVICE_MS;
    const natural = t.ts + length + OVERRUN_MS;
    const next = sorted[i + 1];
    const end = next ? Math.min(natural, next.ts - PRE_SERVICE_MS) : natural;
    return { id: t.id, start, scheduled: t.ts, end: Math.max(end, start) };
  });
}

export type Slot = { kind: "service"; timeId: string; window: ServiceWindow } | { kind: "practice" };

/**
 * What the booth is doing at `now`: inside a service's window, that service;
 * anywhere else (Thursday rehearsal, Sunday morning run-through, Monday with
 * last week's plan still selected) practice. A plan with no scheduled times
 * at all can't be decided by the clock, so it counts as the selected service.
 */
export function slotAt(now: number, times: ServiceSlot[], planMs: number, selectedId: string | null): Slot {
  const windows = serviceWindows(times, planMs);
  if (windows.length === 0) {
    return { kind: "service", timeId: selectedId ?? "default", window: { id: selectedId ?? "default", start: 0, scheduled: 0, end: Infinity } };
  }
  const w = windows.find((x) => now >= x.start && now < x.end);
  return w ? { kind: "service", timeId: w.id, window: w } : { kind: "practice" };
}

/** "2026-10-29": the local day, which keys a day's practice bucket. */
export function dayKey(now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The window to count NFC taps in for a saved service: what it recorded,
 * clipped to its scheduled window so it can't reach into the next service.
 * Buckets from before windows existed are clipped to three hours. Practice
 * never counts taps: the people tapping are at a service.
 */
export function tapWindow(b: {
  rehearsal: boolean;
  startedAt?: number;
  endedAt?: number;
  windowStart?: number;
  windowEnd?: number;
}): { from: number; to: number } | null {
  if (b.rehearsal || !b.startedAt) return null;
  const from = Math.max(b.startedAt, b.windowStart ?? b.startedAt);
  const cap = b.windowEnd ?? b.startedAt + 3 * 3600_000;
  const to = Math.min(b.endedAt ?? b.startedAt, cap);
  return to > from ? { from, to } : null;
}
