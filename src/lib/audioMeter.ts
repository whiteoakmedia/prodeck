// Meter math shared by the SPL readouts, the health banner and the analytics
// sampler, so every surface reports the same number.
//
// The capture thread emits raw RMS/peak 12×/second. Turning that straight into
// a displayed dB value has two problems for a meter a human watches:
//
//  1. A connected-but-silent input alternates between exactly 0.0 and a single
//     dither LSB (~1e-7 on 24-bit). Unfloored, 20·log10 of that reads −100 dB
//     one frame and −140 the next — so the readout thrashes by tens of dB while
//     nothing is actually playing. Clamping to a floor makes silence read as a
//     steady floor instead.
//  2. Even with real program material an unsmoothed 12 Hz integer readout
//     jitters constantly, because RMS moves between every window.
//
// So: clamp to DB_FLOOR, then apply meter ballistics — fast attack so transients
// still register, slower release so the number settles, the way a hardware SPL
// meter's time weighting behaves.

export const DB_FLOOR = -100;

// Linear amplitude (0..1) → dBFS, floored. Silence is DB_FLOOR, never −∞.
export function toDbfs(level: number): number {
  if (!(level > 0)) return DB_FLOOR;
  return Math.max(DB_FLOOR, 20 * Math.log10(level));
}

// Per-update smoothing coefficients (applied at the ~12 Hz emit rate). Release
// is slow enough to read (~0.5s settle) without lagging behind the program.
const ATTACK = 0.55;
const RELEASE = 0.18;

// One ballistics step in the dB domain: rises quickly, falls gently.
export function ballistics(prev: number, next: number): number {
  if (!Number.isFinite(prev)) return next;
  return prev + (next - prev) * (next > prev ? ATTACK : RELEASE);
}

// Time-aware variant. The fixed coefficients above assume ~12 updates/s, but
// web clients receive a throttled ~5/s stream of INSTANTANEOUS frames — the
// same per-step factors applied to sparser, spikier samples made phone meters
// slam up and down ("aggressive spiking"). Deriving the step from the real
// elapsed time gives every surface the same time-constant behaviour no matter
// the frame rate: τ 150 ms up, 650 ms down (≈ a hardware meter's "fast").
const TAU_ATTACK_MS = 150;
const TAU_RELEASE_MS = 650;

export function ballisticsDt(prev: number, next: number, dtMs: number): number {
  if (!Number.isFinite(prev)) return next;
  const tau = next > prev ? TAU_ATTACK_MS : TAU_RELEASE_MS;
  const alpha = 1 - Math.exp(-Math.max(1, dtMs) / tau);
  return prev + (next - prev) * alpha;
}
