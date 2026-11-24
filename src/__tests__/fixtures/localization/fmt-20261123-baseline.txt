// Time formatting shared by the crew screens.

export const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** "8:00 AM" today, "Sun 8:00 AM" any other day. */
export const dayClock = (ms: number) => {
  const d = new Date(ms);
  return sameDay(d, new Date())
    ? clock(ms)
    : `${d.toLocaleDateString([], { weekday: "short" })} ${clock(ms)}`;
};

/** "Sun, Aug 16 · 8:00 AM" (date dropped when it's today). */
export const dateClock = (ms: number) => {
  const d = new Date(ms);
  return sameDay(d, new Date())
    ? `today · ${clock(ms)}`
    : `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · ${clock(ms)}`;
};

/** Countdown that stays readable at any distance:
 *  within ±2h → "T-24" / "T+13" (minutes, the Sunday-morning form);
 *  beyond   → "2d 7h" / "31h" until, "started" past. */
export function countdown(targetMs: number): { big: string; caption: string } {
  const mins = Math.round((targetMs - Date.now()) / 60000);
  if (mins >= 0 && mins <= 120) return { big: `T-${mins}`, caption: "min to service" };
  if (mins < 0 && mins >= -120) return { big: `T+${Math.abs(mins)}`, caption: "min into service" };
  if (mins < 0) return { big: "done", caption: "service passed" };
  const h = Math.floor(mins / 60);
  if (h < 48) return { big: `${h}h ${mins % 60}m`, caption: "to service" };
  return { big: `${Math.floor(h / 24)}d ${h % 24}h`, caption: "to service" };
}
