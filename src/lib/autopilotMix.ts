// Autopilot, part 2: the lapel ride and the room hold (pure; tested in
// autopilot-mix.test.ts). The provider feeds them readings and sends the
// fader values they return to the desk.
//
// Everything is bounded around the operator's own home position, moves
// slowly, and stops the moment a person touches that fader.

/** Avantis fader: raw 0–127, dB = raw/127·64 − 54 (0 = −∞ in practice). */
export const rawToDb = (v: number) => (v / 127) * 64 - 54;
export const dbToRaw = (db: number) => Math.max(0, Math.min(127, Math.round(((db + 54) * 127) / 64)));

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : NaN;
};

/** Speech above this (dBFS on the pre-fader feed) counts as talking. */
export const TALK_DB = -45;

/** Keeps the pastor's lapel steady: evens out his level as he turns and
 *  leans (against his own typical level this message), and nudges toward the
 *  room target (65–70 dB(A) in the message). Within ±6 dB of home. */
export class LapelRide {
  private speech: { t: number; db: number }[] = [];
  private room: { t: number; db: number }[] = [];
  private ref: number | null = null;
  private bias = 0;
  private lastBiasAt = 0;
  private ringUntil = 0;
  private current: number;
  constructor(
    public home: number, // dB
    public target: [number, number] = [65, 70],
    public range = 6,
  ) {
    this.current = home;
  }

  onSpeech(db: number, t: number) {
    if (db < TALK_DB) return;
    this.speech.push({ t, db });
    while (this.speech.length && this.speech[0].t < t - 60_000) this.speech.shift();
    // His typical level: the median of the first 20 s of talking, then of
    // the last minute.
    if (this.speech.length >= 40) this.ref = median(this.speech.map((s) => s.db));
  }

  onRoom(dbA: number, t: number, talking: boolean) {
    if (!talking) return;
    this.room.push({ t, db: dbA });
    while (this.room.length && this.room[0].t < t - 10_000) this.room.shift();
  }

  /** Feedback on the lapel: down 3 dB now, held 20 s. */
  onRing(t: number): number {
    this.ringUntil = t + 20_000;
    this.current = Math.max(this.home - this.range, this.current - 3);
    return this.current;
  }

  /** The fader position it wants now (dB), or null for "leave it". */
  tick(t: number): number | null {
    if (t < this.ringUntil) return null;
    // The room: a slow bias toward the target band, every 10 s.
    if (this.room.length >= 20 && t - this.lastBiasAt >= 10_000) {
      const leq = 10 * Math.log10(this.room.reduce((a, r) => a + 10 ** (r.db / 10), 0) / this.room.length);
      if (leq < this.target[0]) this.bias += 0.5;
      else if (leq > this.target[1]) this.bias -= 0.5;
      this.bias = Math.max(-4, Math.min(4, this.bias));
      this.lastBiasAt = t;
    }
    // His level now against his typical level (last 1.5 s of talking).
    let even = 0;
    const recent = this.speech.filter((s) => s.t >= t - 1500);
    if (this.ref != null && recent.length >= 5) even = Math.max(-6, Math.min(6, (this.ref - median(recent.map((s) => s.db))) * 0.7));
    const want = Math.max(this.home - this.range, Math.min(this.home + this.range, this.home + even + this.bias));
    // Slew: at most 1 dB a tick (the provider ticks every 500 ms); ignore
    // changes under half a dB (one fader step).
    const step = Math.max(-1, Math.min(1, want - this.current));
    if (Math.abs(step) < 0.5) return null;
    this.current += step;
    return this.current;
  }
}

/** Keeps the room in the worship band (90–93 dB(A)) during songs by
 *  nudging the main DCA half a dB at a time, within ±3 dB of home. */
export class RoomHold {
  private room: { t: number; db: number }[] = [];
  private offset = 0;
  private lastStep = 0;
  constructor(
    public home: number,
    public target: [number, number] = [90, 93],
    public range = 3,
  ) {}

  onRoom(dbA: number, t: number) {
    this.room.push({ t, db: dbA });
    while (this.room.length && this.room[0].t < t - 20_000) this.room.shift();
  }

  reset() {
    this.room = [];
  }

  tick(t: number): number | null {
    if (this.room.length < 60 || t - this.lastStep < 8000) return null;
    const leq = 10 * Math.log10(this.room.reduce((a, r) => a + 10 ** (r.db / 10), 0) / this.room.length);
    let next = this.offset;
    if (leq > this.target[1]) next -= 0.5;
    else if (leq < this.target[0]) next += 0.5;
    next = Math.max(-this.range, Math.min(this.range, next));
    if (next === this.offset) return null;
    this.offset = next;
    this.lastStep = t;
    return this.home + this.offset;
  }
}
