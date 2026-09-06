// Shared audio + haptics for crew phones.
//
// iOS unlocks WebAudio only after a user gesture, once per page load — so the
// context is created/resumed on the FIRST touch anywhere (priming), and every
// later programmatic tone works, including a page arriving minutes later.
// navigator.vibrate is Android-only; on iPhones the physical buzz comes from
// the push notification itself, and in-app we rely on sound.
//
// The BOOTH DESKTOP is hard-silenced: its output feeds the house mix, so a
// chat chime would play over the room. Every function here no-ops when not a
// web client — this is policy, not a preference, and no toggle overrides it.

import { IS_WEB } from "./tauri";

let ctx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  if (!IS_WEB) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/** Call once at app start (web): first touch unlocks the audio context. */
export function primeAudio() {
  const unlock = () => {
    ensureCtx();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("touchstart", unlock);
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("touchstart", unlock, { passive: true });
}

function tone(at: number, freq: number, durMs: number, gain: number, shape: OscillatorType = "sine") {
  const c = ensureCtx();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.value = freq;
  o.type = shape;
  const t0 = c.currentTime + at;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + durMs / 1000 + 0.05);
}

/** Soft two-note chime — chat messages. */
export function chime() {
  tone(0, 740, 220, 0.12);
  tone(0.16, 988, 220, 0.12);
}

/** Urgent siren — incoming page. SQUARE wave (a sine is polite; a square
 *  cuts through a pocket or a noisy lobby), four rising notes doubled an
 *  octave down for body, near-max gain. Repeats via caller. */
export function pageTone() {
  const notes: [number, number][] = [
    [0, 880],
    [0.18, 1108],
    [0.36, 1318],
    [0.56, 1760],
  ];
  for (const [at, f] of notes) {
    tone(at, f, 200, 0.5, "square");
    tone(at, f / 2, 200, 0.25, "square");
  }
  tone(0.78, 1760, 320, 0.55, "square");
}

/** Vibrate where supported (Android). Safe no-op elsewhere. Returns whether
 *  the device actually took the pattern, so callers can lean on sound when
 *  it didn't (every iPhone — WebKit has no Vibration API). */
export function buzz(pattern: number | number[]): boolean {
  if (!IS_WEB) return false;
  try {
    return (navigator as any).vibrate?.(pattern) === true;
  } catch {
    return false; /* not supported */
  }
}

/**
 * Page vibration, escalating the longer it goes unconfirmed.
 *
 * Perceived strength on Android is all duration and duty cycle — the API has
 * no intensity control — so these get longer and denser rather than "harder".
 * Stage 0 already lands heavier than the old single pattern; by stage 2 the
 * phone is buzzing almost continuously.
 *
 * IMPORTANT: navigator.vibrate() CANCELS whatever is still running, so a
 * caller must let the pattern finish before firing the next one. The old
 * loop re-triggered every 1.8 s against a 2.44 s pattern, which meant the
 * long closing pulse — the part you actually feel through a pocket — was cut
 * off every single time. Use PAGE_BUZZ_STAGES with patternMs() to schedule.
 */
export const PAGE_BUZZ_STAGES: number[][] = [
  // Three solid hits, ending long.
  [550, 110, 550, 110, 1200],
  // A sharp stutter to catch attention, then two heavy pulses.
  [90, 70, 90, 70, 90, 70, 1400, 160, 1400],
  // Relentless: near-continuous until someone confirms.
  [1700, 150, 1700, 150, 1700],
];

/** Total wall time of a vibration pattern, including its gaps. */
export function patternMs(pattern: number[]): number {
  return pattern.reduce((a, b) => a + b, 0);
}
