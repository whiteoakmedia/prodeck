// When to fade the walk-in music out: so that it's silent as the service
// starts. Pure, so it can be tested without a clock or a music app.

import { serviceTimesOnly, type ClockTime } from "./serviceClock";

export interface FadePlan {
  /** The service time this fade is for (fade once per service). */
  timeId: string;
  /** Seconds the fade should take: the setting, or less if we're already late. */
  secs: number;
}

/**
 * The fade to run now, or null. Due once the moment the music should be silent
 * (the service time, less `leadSecs`) is closer than the fade length, and not
 * yet done for that service. Started late (ProDeck opened a few seconds before),
 * it fades faster so it still lands on time.
 */
export function fadeDue(times: ClockTime[], now: number, fadeSecs: number, done: string[], leadSecs = 0): FadePlan | null {
  // The next start, not servicePhase: between two services the earlier one
  // still counts as "in progress" until the next begins, which would have
  // left the walk-in music before the second service playing straight in.
  const next = serviceTimesOnly(times).find((t) => t.ts > now);
  if (!next) return null;
  const until = Math.ceil((silentAt(next.ts, leadSecs) - now) / 1000);
  const secs = Math.max(1, Math.round(fadeSecs));
  if (until > secs || done.includes(next.id)) return null;
  return { timeId: next.id, secs: Math.max(1, Math.min(secs, until)) };
}

/** When the music should be silent for a service starting at `ts`. */
export function silentAt(ts: number, leadSecs = 0): number {
  return ts - Math.max(0, Math.round(leadSecs)) * 1000;
}
