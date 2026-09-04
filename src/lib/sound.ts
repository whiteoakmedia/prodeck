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

/** Vibrate where supported (Android). Safe no-op elsewhere. */
export function buzz(pattern: number | number[]) {
  if (!IS_WEB) return;
  try {
    (navigator as any).vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}
